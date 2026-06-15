import { useState } from "react";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import MediaTab from "../components/MediaTab";
import SeoTab from "../components/SeoTab";

// ─── LOADER ───────────────────────────────────────────────
export async function loader({ request, params }) {
  let admin;
  try {
    const auth = await authenticate.admin(request);
    admin = auth.admin;
  } catch {
    throw new Error("Unauthorized session");
  }

  const { handle } = params;

  // E-01: handle must exist
  if (!handle) {
    throw new Error("Handle is required to load product");
  }

  const response = await admin.graphql(
    `
    query ProductByHandle($handle: String!) {
      products(first: 1, query: $handle) {
        nodes {
          id
          title
          handle
          media(first: 250) {
            nodes {
              ... on MediaImage {
                id
                alt
                image { url }
              }
            }
          }
        }
      }
    }
    `,
    { variables: { handle: `handle:${handle}` } }
  );

  const result = await response.json();
  const product = result.data.products.nodes[0];

  // E-04: product must exist
  if (!product) {
    throw new Error("Product not found");
  }

  // NEVER return SEO data here — lazy loaded in SeoTab (AC07)
  return { product };
}

// ─── ACTION ───────────────────────────────────────────────
export async function action({ request }) {
  let admin;
  try {
    const auth = await authenticate.admin(request);
    admin = auth.admin;
  } catch {
    return { error: "Unauthorized session" };
  }

  const formData = await request.formData();

  // E-02: handle must exist — we now send the real product handle
  const handle = formData.get("handle");
  if (!handle) {
    return { error: "Handle is required to update product" };
  }

  // E-05: productId must exist
  const productId = formData.get("productId");
  if (!productId) {
    return { error: "Invalid product payload" };
  }

  // E-06: tab must be known
  const tab = formData.get("_tab");
  if (!tab || (tab !== "media" && tab !== "seo")) {
    return { error: "Unsupported tab" };
  }

  // ── MEDIA SAVE ──────────────────────────────────────────
  if (tab === "media") {
    const removedIds = formData.getAll("removeIds");
    const featuredId = formData.get("featuredId");
    const featuredChanged = formData.get("featuredChanged") === "yes";
    const mediaUpdates = JSON.parse(formData.get("mediaUpdates") || "[]");
    const newUrlImages = JSON.parse(formData.get("newImages") || "[]");
    const uploadCount = parseInt(formData.get("uploadCount") || "0", 10);

    // Read file uploads
    const newFileImages = [];
    for (let i = 0; i < uploadCount; i++) {
      const file = formData.get(`uploadFile_${i}`);
      const alt = formData.get(`uploadAlt_${i}`) || "";
      if (file) newFileImages.push({ file, alt });
    }

    const hasUrlImages = newUrlImages.length > 0;
    const hasFileImages = newFileImages.length > 0;
    const hasRemoved = removedIds.length > 0;
    const hasUpdated = mediaUpdates.length > 0;

    // NO-OP check — AC05: nothing changed, fire zero mutations
    if (!hasUrlImages && !hasFileImages && !hasRemoved && !hasUpdated && !featuredChanged) {
      return { success: true, tab: "media", noop: true };
    }

    try {
      // ── Mutation 1: productUpdateMedia — alt text or position changed ──
      if (hasUpdated) {
        const res = await admin.graphql(
          `
          mutation productUpdateMedia($productId: ID!, $media: [UpdateMediaInput!]!) {
            productUpdateMedia(productId: $productId, media: $media) {
              media { id alt }
              mediaUserErrors { field message }
            }
          }
          `,
          { variables: { productId, media: mediaUpdates } }
        );
        const result = await res.json();
        const errors = result.data?.productUpdateMedia?.mediaUserErrors;
        if (errors?.length > 0) {
          return { error: "Unable to update product right now. Please try again.", tab: "media" };
        }
      }

      // ── Mutation 2a: productCreateMedia — URL-based new images ──
      if (hasUrlImages) {
        // Fetch existing Shopify images to prevent server-side URL duplicates
        const existingRes = await admin.graphql(
          `query ProductMedia($id: ID!) {
            product(id: $id) {
              media(first: 250) {
                nodes {
                  ... on MediaImage { image { url } }
                }
              }
            }
          }`,
          { variables: { id: productId } }
        );
        const existingResult = await existingRes.json();
        const existingUrls = new Set(
          (existingResult.data?.product?.media?.nodes || [])
            .map((n) => n.image?.url)
            .filter(Boolean)
            .map((u) => u.split("?")[0].toLowerCase()) // strip query params
        );

        // Only add URLs not already in Shopify
        const uniqueUrlImages = newUrlImages.filter((img) => {
          const normalized = img.url.split("?")[0].toLowerCase();
          return !existingUrls.has(normalized);
        });

        if (uniqueUrlImages.length > 0) {
          const res = await admin.graphql(
            `
            mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
              productCreateMedia(productId: $productId, media: $media) {
                media { id alt }
                mediaUserErrors { field message }
              }
            }
            `,
            {
              variables: {
                productId,
                media: uniqueUrlImages.map((img) => ({
                  originalSource: img.url,
                  alt: img.alt,
                  mediaContentType: "IMAGE",
                })),
              },
            }
          );
          const result = await res.json();
          const errors = result.data?.productCreateMedia?.mediaUserErrors;
          if (errors?.length > 0) {
            return { error: "Unable to update product right now. Please try again.", tab: "media" };
          }
        }
      }

      // ── Mutation 2b: File upload — staged upload then productCreateMedia ──
      if (hasFileImages) {
        // Fetch existing images for file duplicate check using filename hint
        const existingRes = await admin.graphql(
          `query ProductMedia($id: ID!) {
            product(id: $id) {
              media(first: 250) {
                nodes {
                  ... on MediaImage { image { url } }
                }
              }
            }
          }`,
          { variables: { id: productId } }
        );
        const existingResult = await existingRes.json();
        const existingFileNames = new Set(
          (existingResult.data?.product?.media?.nodes || [])
            .map((n) => {
              const url = n.image?.url || "";
              // Extract filename from CDN URL
              const parts = url.split("/");
              const filename = parts[parts.length - 1].split("?")[0];
              // Remove Shopify size suffix like _800x from filename
              return filename.replace(/_\d+x\d*(\.\w+)$/, "$1").toLowerCase();
            })
            .filter(Boolean)
        );

        for (const { file, alt } of newFileImages) {
          // Check if a file with same name already exists in Shopify
          const normalizedName = file.name.toLowerCase();
          if (existingFileNames.has(normalizedName)) {
            // Skip — already exists
            continue;
          }

          // Step 1: Get a staged upload URL from Shopify
          const stageRes = await admin.graphql(
            `
            mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
              stagedUploadsCreate(input: $input) {
                stagedTargets {
                  url
                  resourceUrl
                  parameters { name value }
                }
                userErrors { field message }
              }
            }
            `,
            {
              variables: {
                input: [{
                  filename: file.name,
                  mimeType: file.type,
                  resource: "IMAGE",
                  fileSize: String(file.size),
                  httpMethod: "POST",
                }],
              },
            }
          );
          const stageResult = await stageRes.json();
          const stageErrors = stageResult.data?.stagedUploadsCreate?.userErrors;
          if (stageErrors?.length > 0) {
            return { error: "Unable to update product right now. Please try again.", tab: "media" };
          }

          const target = stageResult.data?.stagedUploadsCreate?.stagedTargets?.[0];
          if (!target) {
            return { error: "Unable to update product right now. Please try again.", tab: "media" };
          }

          // Step 2: Upload file to Shopify's staged URL
          const uploadForm = new FormData();
          target.parameters.forEach(({ name, value }) => uploadForm.append(name, value));
          uploadForm.append("file", file);
          const uploadRes = await fetch(target.url, { method: "POST", body: uploadForm });
          if (!uploadRes.ok) {
            return { error: "Unable to update product right now. Please try again.", tab: "media" };
          }

          // Step 3: Create media using the staged resourceUrl
          const createRes = await admin.graphql(
            `
            mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
              productCreateMedia(productId: $productId, media: $media) {
                media { id alt }
                mediaUserErrors { field message }
              }
            }
            `,
            {
              variables: {
                productId,
                media: [{
                  originalSource: target.resourceUrl,
                  alt,
                  mediaContentType: "IMAGE",
                }],
              },
            }
          );
          const createResult = await createRes.json();
          const createErrors = createResult.data?.productCreateMedia?.mediaUserErrors;
          if (createErrors?.length > 0) {
            return { error: "Unable to update product right now. Please try again.", tab: "media" };
          }
        }
      }

      // ── Mutation 3: productDeleteMedia — images removed ──
      if (hasRemoved) {
        const res = await admin.graphql(
          `
          mutation productDeleteMedia($productId: ID!, $mediaIds: [ID!]!) {
            productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
              deletedMediaIds
              mediaUserErrors { field message }
            }
          }
          `,
          { variables: { productId, mediaIds: removedIds } }
        );
        const result = await res.json();
        const errors = result.data?.productDeleteMedia?.mediaUserErrors;
        if (errors?.length > 0) {
          return { error: "Unable to update product right now. Please try again.", tab: "media" };
        }
      }

      // ── Mutation 4: productReorderMedia — set featured image to position 0 ──
      if (featuredChanged && featuredId && !featuredId.startsWith("new-")) {
        const res = await admin.graphql(
          `
          mutation productReorderMedia($id: ID!, $moves: [MoveInput!]!) {
            productReorderMedia(id: $id, moves: $moves) {
              job { id }
              mediaUserErrors { field message }
            }
          }
          `,
          {
            variables: {
              id: productId,
              moves: [{ id: featuredId, newPosition: "0" }],
            },
          }
        );
        const result = await res.json();
        const errors = result.data?.productReorderMedia?.mediaUserErrors;
        if (errors?.length > 0) {
          return { error: "Unable to update product right now. Please try again.", tab: "media" };
        }
      }

      return { success: true, tab: "media" };

    } catch (e) {
      console.error("Media save error:", e);
      // E-07
      return { error: "Unable to update product right now. Please try again.", tab: "media" };
    }
  }

  // ── SEO SAVE ────────────────────────────────────────────
  if (tab === "seo") {
    const newTitle = formData.get("seoTitle");
    const newDescription = formData.get("seoDescription");
    const newHandle = formData.get("seoHandle");
    const origTitle = formData.get("origTitle");
    const origDescription = formData.get("origDescription");
    const origHandle = formData.get("origHandle");

    // DIFF CHECK — only fire mutation if something changed
    const titleChanged = newTitle !== origTitle;
    const descChanged = newDescription !== origDescription;
    const handleChanged = newHandle !== origHandle;

    // NO-OP — AC05
    if (!titleChanged && !descChanged && !handleChanged) {
      return { success: true, tab: "seo", noop: true };
    }

    try {
      const res = await admin.graphql(
        `
        mutation productUpdate($input: ProductInput!) {
          productUpdate(input: $input) {
            product {
              id
              handle
              seo { title description }
            }
            userErrors { field message }
          }
        }
        `,
        {
          variables: {
            input: {
              id: productId,
              seo: { title: newTitle, description: newDescription },
              handle: newHandle,
            },
          },
        }
      );

      const result = await res.json();
      const errors = result.data?.productUpdate?.userErrors;

      if (errors?.length > 0) {
        // E-09: exact message for duplicate handle
        const isHandleError = errors.some(
          (e) =>
            e.message.toLowerCase().includes("handle") ||
            e.field?.includes("handle")
        );
        if (isHandleError) {
          return {
            error: `URL handle "${newHandle}" is already in use.`,
            tab: "seo",
          };
        }
        return {
          error: "Unable to update product right now. Please try again.",
          tab: "seo",
        };
      }

      // If handle changed redirect to new URL
      if (handleChanged) {
        const { redirect } = await import("react-router");
        return redirect(`/app/products/${newHandle}/edit?tab=seo&saved=true`);
      }

      return { success: true, tab: "seo" };

    } catch {
      // E-07
      return {
        error: "Unable to update product right now. Please try again.",
        tab: "seo",
      };
    }
  }

  return null;
}

// ─── PAGE COMPONENT ───────────────────────────────────────
export default function ProductEditor() {
  const { product } = useLoaderData();
  const [activeTab, setActiveTab] = useState("media");

  return (
    <div style={{ padding: "24px", fontFamily: "sans-serif", maxWidth: "960px", margin: "0 auto" }}>
      <h1 style={{ marginBottom: "4px", fontSize: "22px" }}>Product Media & SEO</h1>
      <p style={{ color: "#666", marginBottom: "24px", fontSize: "14px" }}>
        Editing: <strong>{product.title}</strong>
      </p>

      {/* AC01: Exactly 2 tabs — Media and SEO */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "0" }}>
        <button
          onClick={() => setActiveTab("media")}
          style={{
            padding: "10px 28px",
            background: activeTab === "media" ? "#008060" : "#f0f0f0",
            color: activeTab === "media" ? "white" : "#333",
            border: "none",
            borderBottom: activeTab === "media" ? "3px solid #005c45" : "3px solid transparent",
            borderRadius: "6px 6px 0 0",
            cursor: "pointer",
            fontWeight: "600",
            fontSize: "14px",
          }}
        >
          Media
        </button>
        <button
          onClick={() => setActiveTab("seo")}
          style={{
            padding: "10px 28px",
            background: activeTab === "seo" ? "#008060" : "#f0f0f0",
            color: activeTab === "seo" ? "white" : "#333",
            border: "none",
            borderBottom: activeTab === "seo" ? "3px solid #005c45" : "3px solid transparent",
            borderRadius: "6px 6px 0 0",
            cursor: "pointer",
            fontWeight: "600",
            fontSize: "14px",
          }}
        >
          SEO
        </button>
      </div>

      <div style={{
        border: "1px solid #ddd",
        borderRadius: "0 6px 6px 6px",
        padding: "24px",
        background: "white",
      }}>
        {activeTab === "media" && <MediaTab product={product} />}
        {/* SEO tab only mounts when clicked = lazy load (AC07) */}
        {activeTab === "seo" && <SeoTab product={product} />}
      </div>
    </div>
  );
}

import { useReducer, useCallback, useRef, useState, useEffect } from "react";
import { useLoaderData, redirect, useSearchParams, useSubmit, useNavigation, useActionData } from "react-router";
import { authenticate } from "../shopify.server";
import MediaTab from "../components/MediaTab";
import SeoTab from "../components/SeoTab";
import ProductEditLayout from "../components/ProductEditLayout";

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

  // E-01
  if (!handle) {
    throw new Error("Handle is required to load product");
  }

  const response = await admin.graphql(
    `query ProductByHandle($handle: String!) {
      products(first: 1, query: $handle) {
        nodes {
          id
          title
          handle
          onlineStoreUrl
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
    }`,
    { variables: { handle: `handle:${handle}` } }
  );

  const result = await response.json();
  const product = result.data.products.nodes[0];

  // E-04
  if (!product) {
    throw new Error("Product not found");
  }

  // NEVER return SEO data here — lazy loaded when SEO tab first opened (AC07)
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

  // E-02
  const handle = formData.get("handle");
  if (!handle) {
    return { error: "Handle is required to update product" };
  }

  // E-05
  const productId = formData.get("productId");
  if (!productId) {
    return { error: "Invalid product payload" };
  }

  // E-06 — now accepts "both" as valid tab value for combined save
  const tab = formData.get("_tab");
  if (!tab || !["media", "seo", "both"].includes(tab)) {
    return { error: "Unsupported tab" };
  }

  // Read which sections have changes
  const hasMediaChanges = formData.get("hasMediaChanges") === "true";
  const hasSeoChanges = formData.get("hasSeoChanges") === "true";

  let updatedMedia = null;
  let seoSaved = false;
  let handleChanged = false;
  let newHandle = null;

  // ── MEDIA MUTATIONS ──────────────────────────────────
  if (hasMediaChanges) {
    const removedIds = formData.getAll("removeIds");
    const featuredId = formData.get("featuredId");
    const featuredChanged = formData.get("featuredChanged") === "yes";
    const mediaUpdates = JSON.parse(formData.get("mediaUpdates") || "[]");
    const newUrlImages = JSON.parse(formData.get("newImages") || "[]");
    const reorderMoves = JSON.parse(formData.get("reorderMoves") || "[]");
    const uploadCount = parseInt(formData.get("uploadCount") || "0", 10);

    const newFileImages = [];
    for (let i = 0; i < uploadCount; i++) {
      const file = formData.get(`uploadFile_${i}`);
      const alt = formData.get(`uploadAlt_${i}`) || "";
      if (file) newFileImages.push({ file, alt });
    }

    try {
      // Mutation 1: productUpdateMedia — alt text changed
      if (mediaUpdates.length > 0) {
        const res = await admin.graphql(
          `mutation productUpdateMedia($productId: ID!, $media: [UpdateMediaInput!]!) {
            productUpdateMedia(productId: $productId, media: $media) {
              media { id alt }
              mediaUserErrors { field message }
            }
          }`,
          { variables: { productId, media: mediaUpdates } }
        );
        const result = await res.json();
        const errors = result.data?.productUpdateMedia?.mediaUserErrors;
        if (errors?.length > 0) {
          return { error: "Unable to update product right now. Please try again." };
        }
      }

      // Mutation 2a: productCreateMedia — URL-based new images
      if (newUrlImages.length > 0) {
        // Server-side duplicate check — compare filenames
        const existingRes = await admin.graphql(
          `query ProductMedia($id: ID!) {
            product(id: $id) {
              media(first: 250) {
                nodes { ... on MediaImage { image { url } } }
              }
            }
          }`,
          { variables: { id: productId } }
        );
        const existingResult = await existingRes.json();
        const existingFilenames = new Set(
          (existingResult.data?.product?.media?.nodes || []).map((n) => {
            try {
              const url = n.image?.url || "";
              const filename = new URL(url).pathname.split("/").pop() || "";
              return filename.replace(/_\d+x\d*(\.[^.]+)$/, "$1").replace(/_master(\.[^.]+)$/, "$1").toLowerCase();
            } catch { return ""; }
          }).filter(Boolean)
        );
        const trulyNew = newUrlImages.filter((img) => {
          try {
            const filename = (new URL(img.url).pathname.split("/").pop() || "").toLowerCase();
            return !existingFilenames.has(filename);
          } catch { return true; }
        });
        if (trulyNew.length > 0) {
          const res = await admin.graphql(
            `mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
              productCreateMedia(productId: $productId, media: $media) {
                media { id alt }
                mediaUserErrors { field message }
              }
            }`,
            { variables: { productId, media: trulyNew.map((img) => ({ originalSource: img.url, alt: img.alt, mediaContentType: "IMAGE" })) } }
          );
          const result = await res.json();
          const errors = result.data?.productCreateMedia?.mediaUserErrors;
          if (errors?.length > 0) {
            return { error: "Unable to update product right now. Please try again." };
          }
        }
      }

      // Mutation 2b: file upload — staged upload then productCreateMedia
      for (const { file, alt } of newFileImages) {
        const stageRes = await admin.graphql(
          `mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
            stagedUploadsCreate(input: $input) {
              stagedTargets { url resourceUrl parameters { name value } }
              userErrors { field message }
            }
          }`,
          { variables: { input: [{ filename: file.name, mimeType: file.type, resource: "IMAGE", fileSize: String(file.size), httpMethod: "POST" }] } }
        );
        const stageResult = await stageRes.json();
        if (stageResult.data?.stagedUploadsCreate?.userErrors?.length > 0) {
          return { error: "Unable to update product right now. Please try again." };
        }
        const target = stageResult.data?.stagedUploadsCreate?.stagedTargets?.[0];
        if (!target) return { error: "Unable to update product right now. Please try again." };

        const uploadForm = new FormData();
        target.parameters.forEach(({ name, value }) => uploadForm.append(name, value));
        uploadForm.append("file", file);
        const uploadRes = await fetch(target.url, { method: "POST", body: uploadForm });
        if (!uploadRes.ok) return { error: "Unable to update product right now. Please try again." };

        const createRes = await admin.graphql(
          `mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
            productCreateMedia(productId: $productId, media: $media) {
              media { id alt }
              mediaUserErrors { field message }
            }
          }`,
          { variables: { productId, media: [{ originalSource: target.resourceUrl, alt, mediaContentType: "IMAGE" }] } }
        );
        const createResult = await createRes.json();
        if (createResult.data?.productCreateMedia?.mediaUserErrors?.length > 0) {
          return { error: "Unable to update product right now. Please try again." };
        }
      }

      // Mutation 3: productDeleteMedia
      if (removedIds.length > 0) {
        const res = await admin.graphql(
          `mutation productDeleteMedia($productId: ID!, $mediaIds: [ID!]!) {
            productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
              deletedMediaIds
              mediaUserErrors { field message }
            }
          }`,
          { variables: { productId, mediaIds: removedIds } }
        );
        const result = await res.json();
        if (result.data?.productDeleteMedia?.mediaUserErrors?.length > 0) {
          return { error: "Unable to update product right now. Please try again." };
        }
      }

      // Mutation 4: productReorderMedia — drag reorder
      if (reorderMoves.length > 0) {
        const res = await admin.graphql(
          `mutation productReorderMedia($id: ID!, $moves: [MoveInput!]!) {
            productReorderMedia(id: $id, moves: $moves) {
              job { id }
              mediaUserErrors { field message }
            }
          }`,
          { variables: { id: productId, moves: reorderMoves } }
        );
        const result = await res.json();
        if (result.data?.productReorderMedia?.mediaUserErrors?.length > 0) {
          return { error: "Unable to update product right now. Please try again." };
        }
      }

      // Mutation 5: productReorderMedia — set featured image
      if (featuredChanged && featuredId && !featuredId.startsWith("new-")) {
        const res = await admin.graphql(
          `mutation productReorderMedia($id: ID!, $moves: [MoveInput!]!) {
            productReorderMedia(id: $id, moves: $moves) {
              job { id }
              mediaUserErrors { field message }
            }
          }`,
          { variables: { id: productId, moves: [{ id: featuredId, newPosition: "0" }] } }
        );
        const result = await res.json();
        if (result.data?.productReorderMedia?.mediaUserErrors?.length > 0) {
          return { error: "Unable to update product right now. Please try again." };
        }
      }

      // Fetch fresh media to return to client
      const refreshRes = await admin.graphql(
        `query ProductMediaRefresh($id: ID!) {
          product(id: $id) {
            media(first: 250) {
              nodes { ... on MediaImage { id alt image { url } } }
            }
          }
        }`,
        { variables: { id: productId } }
      );
      const refreshResult = await refreshRes.json();
      updatedMedia = refreshResult.data?.product?.media?.nodes || [];

    } catch (e) {
      console.error("Media save error:", e);
      return { error: "Unable to update product right now. Please try again." };
    }
  }

  // ── SEO MUTATIONS ────────────────────────────────────
  if (hasSeoChanges) {
    const seoTitle = formData.get("seoTitle");
    const seoDescription = formData.get("seoDescription");
    newHandle = formData.get("seoHandle");
    const origTitle = formData.get("origTitle");
    const origDescription = formData.get("origDescription");
    const origHandle = formData.get("origHandle");

    const titleChanged = seoTitle !== origTitle;
    const descChanged = seoDescription !== origDescription;
    handleChanged = newHandle !== origHandle;

    if (titleChanged || descChanged || handleChanged) {
      try {
        const res = await admin.graphql(
          `mutation productUpdate($input: ProductInput!) {
            productUpdate(input: $input) {
              product { id handle seo { title description } }
              userErrors { field message }
            }
          }`,
          { variables: { input: { id: productId, seo: { title: seoTitle, description: seoDescription }, handle: newHandle } } }
        );
        const result = await res.json();
        const errors = result.data?.productUpdate?.userErrors;
        if (errors?.length > 0) {
          const isHandleError = errors.some(
            (e) => e.message.toLowerCase().includes("handle") || e.field?.includes("handle")
          );
          if (isHandleError) {
            return { error: `URL handle "${newHandle}" is already in use.`, tab: "seo" };
          }
          return { error: "Unable to update product right now. Please try again." };
        }
        seoSaved = true;
      } catch {
        return { error: "Unable to update product right now. Please try again." };
      }
    }
  }

  // If handle changed — redirect to new URL
  if (handleChanged && newHandle) {
    return redirect(`/app/products/${newHandle}/edit?saved=true`);
  }

  return {
    success: true,
    updatedMedia,  // null if no media changes
    seoSaved,
  };
}

// ─── SHARED FORM REDUCER ──────────────────────────────────
// Manages ALL form state for both tabs in one place (spec 1.5)
// Switching tabs never resets the other tab's edits

function buildInitialMediaState(nodes) {
  return nodes.map((img, index) => ({
    id: img.id,
    url: img.image?.url,
    alt: img.alt || "",
    position: index,
    isNew: false,
    toDelete: false,
    isFile: false,
  }));
}

function buildInitialOrigImages(nodes) {
  return nodes.map((img, index) => ({
    id: img.id,
    alt: img.alt || "",
    position: index,
  }));
}

function createInitialState(product) {
  return {
    media: {
      images: buildInitialMediaState(product.media.nodes),
      origImages: buildInitialOrigImages(product.media.nodes),
      featuredId: product.media.nodes[0]?.id || null,
      origFeaturedId: product.media.nodes[0]?.id || null,
      newUrl: "",
      dragIndex: null,
      _registerFiles: null, // set by MediaTab to expose registerAllPendingFiles
    },
    seo: {
      seoTitle: "",
      seoDescription: "",
      seoHandle: "",
      origTitle: "",
      origDescription: "",
      origHandle: "",
      seoLoaded: false,   // false = SEO tab never opened yet
      seoLoading: false,
      seoLoadError: null,
    },
  };
}

function formReducer(state, action) {
  switch (action.type) {

    // ── MEDIA ACTIONS ────────────────────────────────
    case "MEDIA_ALT_CHANGE":
      return {
        ...state,
        media: {
          ...state.media,
          images: state.media.images.map((img) =>
            img.id === action.id ? { ...img, alt: action.value } : img
          ),
        },
      };

    case "MEDIA_REMOVE":
      return {
        ...state,
        media: {
          ...state.media,
          images: state.media.images.map((img) =>
            img.id === action.id ? { ...img, toDelete: true } : img
          ),
          featuredId:
            state.media.featuredId === action.id
              ? (state.media.images.find((img) => !img.toDelete && img.id !== action.id)?.id || null)
              : state.media.featuredId,
        },
      };

    case "MEDIA_ADD_URL":
      return {
        ...state,
        media: {
          ...state.media,
          images: [
            ...state.media.images,
            {
              id: `new-${Date.now()}`,
              url: action.url,
              alt: action.alt,
              position: state.media.images.length,
              isNew: true,
              toDelete: false,
              isFile: false,
            },
          ],
          newUrl: "",
        },
      };

    case "MEDIA_ADD_FILE":
      return {
        ...state,
        media: {
          ...state.media,
          images: [
            ...state.media.images,
            {
              id: `new-${Date.now()}-${Math.random()}`,
              url: action.previewUrl,
              alt: action.alt,
              position: state.media.images.length,
              isNew: true,
              toDelete: false,
              isFile: true,
              file: action.file,
            },
          ],
        },
      };

    case "MEDIA_SET_FEATURED":
      return {
        ...state,
        media: { ...state.media, featuredId: action.id },
      };

    case "MEDIA_SET_NEW_URL":
      return {
        ...state,
        media: { ...state.media, newUrl: action.value },
      };

    case "MEDIA_DRAG_START":
      return {
        ...state,
        media: { ...state.media, dragIndex: action.index },
      };

    case "MEDIA_DRAG_DROP": {
      const { dragIndex, images } = state.media;
      if (dragIndex === null || dragIndex === action.dropIndex) {
        return { ...state, media: { ...state.media, dragIndex: null } };
      }
      const visible = images.filter((img) => !img.toDelete);
      const updated = [...visible];
      const [moved] = updated.splice(dragIndex, 1);
      updated.splice(action.dropIndex, 0, moved);
      const reordered = updated.map((img, i) => ({ ...img, position: i }));
      const deleted = images.filter((img) => img.toDelete);
      return {
        ...state,
        media: {
          ...state.media,
          images: [...reordered, ...deleted],
          dragIndex: null,
        },
      };
    }

    case "MEDIA_RESET":
      // Discard — reset media back to original loader values
      return {
        ...state,
        media: {
          ...state.media,
          images: buildInitialMediaState(action.nodes),
          origImages: buildInitialOrigImages(action.nodes),
          featuredId: action.nodes[0]?.id || null,
          origFeaturedId: action.nodes[0]?.id || null,
          newUrl: "",
          dragIndex: null,
        },
      };

    case "MEDIA_SAVED":
      // After successful save — reset to fresh Shopify state
      return {
        ...state,
        media: {
          ...state.media,
          images: buildInitialMediaState(action.nodes),
          origImages: buildInitialOrigImages(action.nodes),
          featuredId: action.nodes[0]?.id || state.media.featuredId,
          origFeaturedId: action.nodes[0]?.id || state.media.featuredId,
          newUrl: "",
          dragIndex: null,
        },
      };

    // ── SEO ACTIONS ──────────────────────────────────
    case "SEO_LOADING":
      return {
        ...state,
        seo: { ...state.seo, seoLoading: true, seoLoadError: null },
      };

    case "SEO_LOADED":
      return {
        ...state,
        seo: {
          ...state.seo,
          seoTitle: action.title,
          seoDescription: action.description,
          seoHandle: action.handle,
          origTitle: action.title,
          origDescription: action.description,
          origHandle: action.handle,
          seoLoaded: true,
          seoLoading: false,
          seoLoadError: null,
        },
      };

    case "SEO_LOAD_ERROR":
      return {
        ...state,
        seo: { ...state.seo, seoLoading: false, seoLoadError: action.error },
      };

    case "SEO_RESET_ERROR":
      // Allow retry — reset loaded flag so useEffect runs again
      return {
        ...state,
        seo: { ...state.seo, seoLoaded: false, seoLoadError: null },
      };

    case "SEO_TITLE_CHANGE":
      return { ...state, seo: { ...state.seo, seoTitle: action.value } };

    case "SEO_DESCRIPTION_CHANGE":
      return { ...state, seo: { ...state.seo, seoDescription: action.value } };

    case "SEO_HANDLE_CHANGE":
      return { ...state, seo: { ...state.seo, seoHandle: action.value } };

    case "SEO_RESET":
      // Discard — reset SEO back to original loaded values
      return {
        ...state,
        seo: {
          ...state.seo,
          seoTitle: state.seo.origTitle,
          seoDescription: state.seo.origDescription,
          seoHandle: state.seo.origHandle,
        },
      };

    case "SEO_SAVED":
      // After successful SEO save — update originals
      return {
        ...state,
        seo: {
          ...state.seo,
          origTitle: state.seo.seoTitle,
          origDescription: state.seo.seoDescription,
          origHandle: state.seo.seoHandle,
        },
      };

    default:
      return state;
  }
}

// ─── isDirty COMPUTATION ──────────────────────────────────
// Global flag — true if ANY field in either tab has changed (spec 1.5)
function computeIsDirty(formState) {
  const { media, seo } = formState;

  // Media dirty check
  const hasNewImages = media.images.some((img) => img.isNew && !img.toDelete);
  const hasRemovedImages = media.images.some((img) => img.toDelete && !img.isNew);
  const hasAltChanges = media.images.some((img) => {
    if (img.isNew || img.toDelete) return false;
    const orig = media.origImages.find((o) => o.id === img.id);
    return orig && img.alt !== orig.alt;
  });
  const hasReorder = media.images.some((img) => {
    if (img.isNew || img.toDelete) return false;
    const orig = media.origImages.find((o) => o.id === img.id);
    return orig && img.position !== orig.position;
  });
  const hasFeaturedChange =
    media.featuredId !== media.origFeaturedId &&
    media.featuredId !== null &&
    !media.featuredId?.startsWith("new-");

  const isMediaDirty = hasNewImages || hasRemovedImages || hasAltChanges || hasReorder || hasFeaturedChange;

  // SEO dirty check — only if SEO tab was loaded (spec 1.5)
  const isSeoDirty = seo.seoLoaded && (
    seo.seoTitle !== seo.origTitle ||
    seo.seoDescription !== seo.origDescription ||
    seo.seoHandle !== seo.origHandle
  );

  return isMediaDirty || isSeoDirty;
}

// ─── PAGE COMPONENT ───────────────────────────────────────
export default function ProductEditor() {
  const { product } = useLoaderData();
  const [searchParams, setSearchParams] = useSearchParams();
  const submit = useSubmit();
  const navigation = useNavigation();
  const actionData = useActionData();
  const isSaving = navigation.state === "submitting";
  const savedViaRedirect = searchParams.get("saved") === "true";

  const [activeTab, setActiveTab] = useState("media");
  const [formState, dispatch] = useReducer(formReducer, product, createInitialState);

  // Ref to store the registerAllPendingFiles function from MediaTab
  const registerFilesRef = useRef(null);

  // Clean up URL params after redirect
  if (typeof window !== "undefined" && searchParams.get("saved")) {
    setTimeout(() => setSearchParams({}, { replace: true }), 0);
  }

  // After successful save — reset state from Shopify's response
  useEffect(() => {
    if (actionData?.success) {
      if (actionData.updatedMedia) {
        dispatch({ type: "MEDIA_SAVED", nodes: actionData.updatedMedia });
      }
      if (actionData.seoSaved) {
        dispatch({ type: "SEO_SAVED" });
      }
    }
  }, [actionData]);

  const isDirty = computeIsDirty(formState);

  // ── SAVE — submits full combined payload ───────────────
  const handleSave = useCallback(() => {
    const { media, seo } = formState;

    // Register any pending file uploads in localStorage before submit
    if (registerFilesRef.current) {
      registerFilesRef.current();
    }

    // Compute media diff
    const mediaUpdates = [];
    const removeIds = [];
    const newUrlImages = [];
    const newFileImages = [];
    const reorderMoves = [];

    for (const img of media.images) {
      if (img.isNew && !img.toDelete) {
        if (img.isFile && img.file) {
          newFileImages.push(img);
        } else {
          newUrlImages.push({ url: img.url, alt: img.alt });
        }
        continue;
      }
      if (img.toDelete && !img.isNew) {
        removeIds.push(img.id);
        continue;
      }
      const orig = media.origImages.find((o) => o.id === img.id);
      if (orig) {
        if (img.alt !== orig.alt) mediaUpdates.push({ id: img.id, alt: img.alt });
        if (img.position !== orig.position) reorderMoves.push({ id: img.id, newPosition: String(img.position) });
      }
    }

    const featuredChanged =
      media.featuredId !== media.origFeaturedId &&
      media.featuredId !== null &&
      !media.featuredId?.startsWith("new-");

    const hasMediaChanges =
      mediaUpdates.length > 0 ||
      removeIds.length > 0 ||
      newUrlImages.length > 0 ||
      newFileImages.length > 0 ||
      reorderMoves.length > 0 ||
      featuredChanged;

    // Compute SEO diff — only if SEO tab was loaded
    const hasSeoChanges = seo.seoLoaded && (
      seo.seoTitle !== seo.origTitle ||
      seo.seoDescription !== seo.origDescription ||
      seo.seoHandle !== seo.origHandle
    );

    // Global no-op — nothing changed at all
    if (!hasMediaChanges && !hasSeoChanges) return;

    const formData = new FormData();
    formData.append("_tab", "both");
    formData.append("productId", product.id);
    formData.append("handle", product.handle);
    formData.append("hasMediaChanges", String(hasMediaChanges));
    formData.append("hasSeoChanges", String(hasSeoChanges));

    // Media fields
    if (hasMediaChanges) {
      formData.append("featuredId", media.featuredId || "");
      formData.append("featuredChanged", featuredChanged ? "yes" : "no");
      formData.append("mediaUpdates", JSON.stringify(mediaUpdates));
      formData.append("reorderMoves", JSON.stringify(reorderMoves));
      removeIds.forEach((id) => formData.append("removeIds", id));
      formData.append("newImages", JSON.stringify(newUrlImages));
      newFileImages.forEach((img, i) => {
        formData.append(`uploadFile_${i}`, img.file);
        formData.append(`uploadAlt_${i}`, img.alt);
      });
      formData.append("uploadCount", String(newFileImages.length));
    }

    // SEO fields
    if (hasSeoChanges) {
      formData.append("seoTitle", seo.seoTitle);
      formData.append("seoDescription", seo.seoDescription);
      formData.append("seoHandle", seo.seoHandle);
      formData.append("origTitle", seo.origTitle);
      formData.append("origDescription", seo.origDescription);
      formData.append("origHandle", seo.origHandle);
    }

    submit(formData, { method: "post", encType: "multipart/form-data" });
  }, [formState, product, submit]);

  // ── DISCARD — revert ALL state to original values ──────
  const handleDiscard = useCallback(() => {
    // Reset media to original loader values
    dispatch({ type: "MEDIA_RESET", nodes: product.media.nodes });
    // Reset SEO to original loaded values (if SEO was ever loaded)
    if (formState.seo.seoLoaded) {
      dispatch({ type: "SEO_RESET" });
    }
    // If SEO was never loaded, nothing to reset there (spec 1.5)
  }, [formState.seo.seoLoaded, product.media.nodes]);

  return (
    <ProductEditLayout
      product={product}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      isDirty={isDirty}
      isSaving={isSaving}
      onSave={handleSave}
      onDiscard={handleDiscard}
      actionData={actionData}
      savedViaRedirect={savedViaRedirect}
    >
      {activeTab === "media" && (
        <MediaTab
          product={product}
          formState={formState}
          dispatch={dispatch}
        />
      )}
      {/* SEO tab only mounts when first clicked — lazy load (AC07) */}
      {activeTab === "seo" && (
        <SeoTab
          product={product}
          formState={formState}
          dispatch={dispatch}
        />
      )}
    </ProductEditLayout>
  );
}

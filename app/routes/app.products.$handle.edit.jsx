import { useReducer, useState, useEffect } from "react";
import { useLoaderData, redirect, useSearchParams, useSubmit, useNavigation, useActionData } from "react-router";
import { authenticate } from "../shopify.server";
import MediaTab from "../components/MediaTab";
import SeoTab from "../components/SeoTab";
import ProductEditLayout from "../components/ProductEditLayout";

// ─── LOADER ───────────────────────────────────────────────
// Runs on the server before the page loads.
// Fetches the product and its images from Shopify.
// SEO data is NOT fetched here — it loads lazily when SEO tab is clicked (AC07).

export async function loader({ request, params }) {

  // Step 1: Check if the user is logged into Shopify
  let admin;
  try {
    const auth = await authenticate.admin(request);
    admin = auth.admin;
  } catch (error) {
    // E-03: User is not authenticated
    throw new Error("Unauthorized session");
  }

  // Step 2: Get the product handle from the URL
  // Example: /app/products/red-shirt/edit → handle = "red-shirt"
  const handle = params.handle;

  // E-01: Handle is missing from the URL
  if (!handle) {
    throw new Error("Handle is required to load product");
  }

  // Step 3: Ask Shopify for the product details and images
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
    { variables: { handle: "handle:" + handle } }
  );

  const result = await response.json();
  const product = result.data.products.nodes[0];

  // E-04: No product found with this handle
  if (!product) {
    throw new Error("Product not found");
  }

  // Return product data to the page component
  return { product };
}

// ─── ACTION ───────────────────────────────────────────────
// Runs on the server when the user clicks Save.
// Reads the form data and fires the right Shopify mutations.

export async function action({ request }) {

  // Step 1: Check the user is still logged in
  let admin;
  try {
    const auth = await authenticate.admin(request);
    admin = auth.admin;
  } catch (error) {
    return { error: "Unauthorized session" };
  }

  // Step 2: Read the form data that was submitted
  const formData = await request.formData();

  // E-02: Product handle must be included
  const handle = formData.get("handle");
  if (!handle) {
    return { error: "Handle is required to update product" };
  }

  // E-05: Product ID must be included
  const productId = formData.get("productId");
  if (!productId) {
    return { error: "Invalid product payload" };
  }

  // E-06: Tab must be "media", "seo", or "both"
  const tab = formData.get("_tab");
  const validTabs = ["media", "seo", "both"];
  if (!tab || !validTabs.includes(tab)) {
    return { error: "Unsupported tab" };
  }

  // Step 3: Check which sections have changes
  const hasMediaChanges = formData.get("hasMediaChanges") === "true";
  const hasSeoChanges = formData.get("hasSeoChanges") === "true";

  // These will be filled in below
  let updatedMedia = null;
  let seoSaved = false;
  let handleChanged = false;
  let newHandle = null;

  // ── MEDIA MUTATIONS ──────────────────────────────────
  // Only run if user changed something in the Media tab

  if (hasMediaChanges) {

    // Read all the media-related fields from the form
    const removedIds = formData.getAll("removeIds");
    const featuredId = formData.get("featuredId");
    const featuredChanged = formData.get("featuredChanged") === "yes";
    const mediaUpdates = JSON.parse(formData.get("mediaUpdates") || "[]");
    const newUrlImages = JSON.parse(formData.get("newImages") || "[]");
    const reorderMoves = JSON.parse(formData.get("reorderMoves") || "[]");
    const uploadCount = parseInt(formData.get("uploadCount") || "0", 10);

    // Read each uploaded file from the form
    const newFileImages = [];
    for (let i = 0; i < uploadCount; i++) {
      const file = formData.get("uploadFile_" + i);
      const alt = formData.get("uploadAlt_" + i) || "";
      if (file) {
        newFileImages.push({ file: file, alt: alt });
      }
    }

    try {

      // ── Mutation 1: Update alt text on existing images ──
      if (mediaUpdates.length > 0) {
        const res = await admin.graphql(
          `mutation productUpdateMedia($productId: ID!, $media: [UpdateMediaInput!]!) {
            productUpdateMedia(productId: $productId, media: $media) {
              media { id alt }
              mediaUserErrors { field message }
            }
          }`,
          { variables: { productId: productId, media: mediaUpdates } }
        );
        const result = await res.json();
        const errors = result.data.productUpdateMedia.mediaUserErrors;
        if (errors.length > 0) {
          return { error: "Unable to update product right now. Please try again." };
        }
      }

      // ── Mutation 2a: Add new images by URL ──
      if (newUrlImages.length > 0) {

        // First check which images already exist in Shopify (server-side duplicate check)
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
        const existingNodes = existingResult.data.product.media.nodes;

        // Build a set of existing filenames so we can skip duplicates
        const existingFilenames = new Set();
        existingNodes.forEach(function(node) {
          try {
            const url = node.image.url;
            const filename = new URL(url).pathname.split("/").pop() || "";
            // Remove Shopify size suffixes like _800x or _master
            const cleanName = filename
              .replace(/_\d+x\d*(\.[^.]+)$/, "$1")
              .replace(/_master(\.[^.]+)$/, "$1")
              .toLowerCase();
            existingFilenames.add(cleanName);
          } catch (err) {
            // Skip this image if URL parsing fails
          }
        });

        // Only add images that do not already exist
        const trulyNewImages = newUrlImages.filter(function(img) {
          try {
            const filename = new URL(img.url).pathname.split("/").pop().toLowerCase();
            return !existingFilenames.has(filename);
          } catch (err) {
            return true;
          }
        });

        if (trulyNewImages.length > 0) {
          const mediaInput = trulyNewImages.map(function(img) {
            return {
              originalSource: img.url,
              alt: img.alt,
              mediaContentType: "IMAGE",
            };
          });

          const res = await admin.graphql(
            `mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
              productCreateMedia(productId: $productId, media: $media) {
                media { id alt }
                mediaUserErrors { field message }
              }
            }`,
            { variables: { productId: productId, media: mediaInput } }
          );
          const result = await res.json();
          const errors = result.data.productCreateMedia.mediaUserErrors;
          if (errors.length > 0) {
            return { error: "Unable to update product right now. Please try again." };
          }
        }
      }

      // ── Mutation 2b: Upload new images from computer ──
      // File uploads require 3 steps: get upload URL, upload file, then add to product
      for (let i = 0; i < newFileImages.length; i++) {
        const fileItem = newFileImages[i];
        const file = fileItem.file;
        const alt = fileItem.alt;

        // Step 1: Ask Shopify for a temporary upload URL
        const stageRes = await admin.graphql(
          `mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
            stagedUploadsCreate(input: $input) {
              stagedTargets { url resourceUrl parameters { name value } }
              userErrors { field message }
            }
          }`,
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
        const stageErrors = stageResult.data.stagedUploadsCreate.userErrors;
        if (stageErrors.length > 0) {
          return { error: "Unable to update product right now. Please try again." };
        }

        const target = stageResult.data.stagedUploadsCreate.stagedTargets[0];
        if (!target) {
          return { error: "Unable to update product right now. Please try again." };
        }

        // Step 2: Upload the actual file to the temporary URL
        const uploadForm = new FormData();
        target.parameters.forEach(function(param) {
          uploadForm.append(param.name, param.value);
        });
        uploadForm.append("file", file);

        const uploadRes = await fetch(target.url, { method: "POST", body: uploadForm });
        if (!uploadRes.ok) {
          return { error: "Unable to update product right now. Please try again." };
        }

        // Step 3: Tell Shopify to add the uploaded file to the product
        const createRes = await admin.graphql(
          `mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
            productCreateMedia(productId: $productId, media: $media) {
              media { id alt }
              mediaUserErrors { field message }
            }
          }`,
          {
            variables: {
              productId: productId,
              media: [{
                originalSource: target.resourceUrl,
                alt: alt,
                mediaContentType: "IMAGE",
              }],
            },
          }
        );
        const createResult = await createRes.json();
        const createErrors = createResult.data.productCreateMedia.mediaUserErrors;
        if (createErrors.length > 0) {
          return { error: "Unable to update product right now. Please try again." };
        }
      }

      // ── Mutation 3: Delete removed images ──
      if (removedIds.length > 0) {
        const res = await admin.graphql(
          `mutation productDeleteMedia($productId: ID!, $mediaIds: [ID!]!) {
            productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
              deletedMediaIds
              mediaUserErrors { field message }
            }
          }`,
          { variables: { productId: productId, mediaIds: removedIds } }
        );
        const result = await res.json();
        const errors = result.data.productDeleteMedia.mediaUserErrors;
        if (errors.length > 0) {
          return { error: "Unable to update product right now. Please try again." };
        }
      }

      // ── Mutation 4: Save the new order after drag and drop ──
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
        const errors = result.data.productReorderMedia.mediaUserErrors;
        if (errors.length > 0) {
          return { error: "Unable to update product right now. Please try again." };
        }
      }

      // ── Mutation 5: Set featured image by moving it to position 0 ──
      if (featuredChanged && featuredId && !featuredId.startsWith("new-")) {
        const moves = [{ id: featuredId, newPosition: "0" }];
        const res = await admin.graphql(
          `mutation productReorderMedia($id: ID!, $moves: [MoveInput!]!) {
            productReorderMedia(id: $id, moves: $moves) {
              job { id }
              mediaUserErrors { field message }
            }
          }`,
          { variables: { id: productId, moves: moves } }
        );
        const result = await res.json();
        const errors = result.data.productReorderMedia.mediaUserErrors;
        if (errors.length > 0) {
          return { error: "Unable to update product right now. Please try again." };
        }
      }

      // Fetch fresh image list from Shopify to return to the client
      // This lets MediaTab reset its state without a page reload
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
      updatedMedia = refreshResult.data.product.media.nodes;

    } catch (error) {
      console.error("Media save error:", error);
      // E-07
      return { error: "Unable to update product right now. Please try again." };
    }
  }

  // ── SEO MUTATIONS ──────────────────────────────────
  // Only run if user changed something in the SEO tab

  if (hasSeoChanges) {

    // Read SEO fields from the form
    const seoTitle = formData.get("seoTitle");
    const seoDescription = formData.get("seoDescription");
    newHandle = formData.get("seoHandle");
    const origTitle = formData.get("origTitle");
    const origDescription = formData.get("origDescription");
    const origHandle = formData.get("origHandle");

    // Check which SEO fields actually changed
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
          {
            variables: {
              input: {
                id: productId,
                seo: { title: seoTitle, description: seoDescription },
                handle: newHandle,
              },
            },
          }
        );

        const result = await res.json();
        const errors = result.data.productUpdate.userErrors;

        if (errors.length > 0) {
          // Check if this is a duplicate handle error (E-09)
          const isHandleError = errors.some(function(err) {
            return err.message.toLowerCase().includes("handle") || (err.field && err.field.includes("handle"));
          });

          if (isHandleError) {
            // E-09: exact message with the handle value
            return { error: 'URL handle "' + newHandle + '" is already in use.', tab: "seo" };
          }

          return { error: "Unable to update product right now. Please try again." };
        }

        seoSaved = true;

      } catch (error) {
        // E-07
        return { error: "Unable to update product right now. Please try again." };
      }
    }
  }

  // If the URL handle changed, redirect to the new edit page URL
  // Without this the loader would look for the old handle which no longer exists
  if (handleChanged && newHandle) {
    return redirect("/app/products/" + newHandle + "/edit?saved=true");
  }

  // Return success along with fresh data for the client to use
  return {
    success: true,
    updatedMedia: updatedMedia,
    seoSaved: seoSaved,
  };
}

// ─── HELPER FUNCTIONS FOR BUILDING INITIAL STATE ──────────

// Builds the images array from Shopify's media nodes
function buildInitialMediaState(nodes) {
  return nodes.map(function(img, index) {
    return {
      id: img.id,
      url: img.image ? img.image.url : "",
      alt: img.alt || "",
      position: index,
      isNew: false,
      toDelete: false,
      isFile: false,
    };
  });
}

// Builds the original images array used for diff checking on Save
function buildInitialOrigImages(nodes) {
  return nodes.map(function(img, index) {
    return {
      id: img.id,
      alt: img.alt || "",
      position: index,
    };
  });
}

// Builds the full starting state for both tabs
function createInitialState(product) {
  return {
    media: {
      images: buildInitialMediaState(product.media.nodes),
      origImages: buildInitialOrigImages(product.media.nodes),
      featuredId: product.media.nodes[0] ? product.media.nodes[0].id : null,
      origFeaturedId: product.media.nodes[0] ? product.media.nodes[0].id : null,
      newUrl: "",
      dragIndex: null,
    },
    seo: {
      seoTitle: "",
      seoDescription: "",
      seoHandle: "",
      origTitle: "",
      origDescription: "",
      origHandle: "",
      seoLoaded: false,
      seoLoading: false,
      seoLoadError: null,
    },
  };
}

// ─── FORM REDUCER ─────────────────────────────────────────
// All form state changes go through this one function.
// When dispatch is called with an action type, the reducer
// returns the new updated state.

function formReducer(state, action) {

  if (action.type === "MEDIA_ALT_CHANGE") {
    // Update alt text for one image
    const updatedImages = state.media.images.map(function(img) {
      if (img.id === action.id) {
        return Object.assign({}, img, { alt: action.value });
      }
      return img;
    });
    return Object.assign({}, state, {
      media: Object.assign({}, state.media, { images: updatedImages }),
    });
  }

  if (action.type === "MEDIA_REMOVE") {
    // Mark an image as deleted
    const updatedImages = state.media.images.map(function(img) {
      if (img.id === action.id) {
        return Object.assign({}, img, { toDelete: true });
      }
      return img;
    });
    // If the removed image was featured, move featured to the next available image
    let newFeaturedId = state.media.featuredId;
    if (state.media.featuredId === action.id) {
      const nextImage = state.media.images.find(function(img) {
        return !img.toDelete && img.id !== action.id;
      });
      newFeaturedId = nextImage ? nextImage.id : null;
    }
    return Object.assign({}, state, {
      media: Object.assign({}, state.media, {
        images: updatedImages,
        featuredId: newFeaturedId,
      }),
    });
  }

  if (action.type === "MEDIA_ADD_URL") {
    // Add a new image from a URL
    const newImage = {
      id: "new-" + Date.now(),
      url: action.url,
      alt: action.alt,
      position: state.media.images.length,
      isNew: true,
      toDelete: false,
      isFile: false,
    };
    return Object.assign({}, state, {
      media: Object.assign({}, state.media, {
        images: state.media.images.concat([newImage]),
        newUrl: "",
      }),
    });
  }

  if (action.type === "MEDIA_ADD_FILE") {
    // Add a new image from a file upload
    const newImage = {
      id: "new-" + Date.now() + "-" + Math.random(),
      url: action.previewUrl,
      alt: action.alt,
      position: state.media.images.length,
      isNew: true,
      toDelete: false,
      isFile: true,
      file: action.file,
    };
    return Object.assign({}, state, {
      media: Object.assign({}, state.media, {
        images: state.media.images.concat([newImage]),
      }),
    });
  }

  if (action.type === "MEDIA_SET_FEATURED") {
    return Object.assign({}, state, {
      media: Object.assign({}, state.media, { featuredId: action.id }),
    });
  }

  if (action.type === "MEDIA_SET_NEW_URL") {
    return Object.assign({}, state, {
      media: Object.assign({}, state.media, { newUrl: action.value }),
    });
  }

  if (action.type === "MEDIA_DRAG_START") {
    return Object.assign({}, state, {
      media: Object.assign({}, state.media, { dragIndex: action.index }),
    });
  }

  if (action.type === "MEDIA_DRAG_DROP") {
    const dragIndex = state.media.dragIndex;
    const dropIndex = action.dropIndex;

    // Do nothing if no drag is in progress or dropped in the same spot
    if (dragIndex === null || dragIndex === dropIndex) {
      return Object.assign({}, state, {
        media: Object.assign({}, state.media, { dragIndex: null }),
      });
    }

    // Get only visible images (not deleted ones)
    const visibleImages = state.media.images.filter(function(img) {
      return !img.toDelete;
    });

    // Move the dragged image to the new position
    const reordered = visibleImages.slice();
    const movedImage = reordered.splice(dragIndex, 1)[0];
    reordered.splice(dropIndex, 0, movedImage);

    // Update position numbers
    const withPositions = reordered.map(function(img, i) {
      return Object.assign({}, img, { position: i });
    });

    // Add back the deleted images at the end
    const deletedImages = state.media.images.filter(function(img) {
      return img.toDelete;
    });

    return Object.assign({}, state, {
      media: Object.assign({}, state.media, {
        images: withPositions.concat(deletedImages),
        dragIndex: null,
      }),
    });
  }

  if (action.type === "MEDIA_RESET") {
    // Discard all media changes and go back to original values
    return Object.assign({}, state, {
      media: Object.assign({}, state.media, {
        images: buildInitialMediaState(action.nodes),
        origImages: buildInitialOrigImages(action.nodes),
        featuredId: action.nodes[0] ? action.nodes[0].id : null,
        origFeaturedId: action.nodes[0] ? action.nodes[0].id : null,
        newUrl: "",
        dragIndex: null,
      }),
    });
  }

  if (action.type === "MEDIA_SAVED") {
    // After a successful save, reset state to match what Shopify now has
    return Object.assign({}, state, {
      media: Object.assign({}, state.media, {
        images: buildInitialMediaState(action.nodes),
        origImages: buildInitialOrigImages(action.nodes),
        featuredId: action.nodes[0] ? action.nodes[0].id : state.media.featuredId,
        origFeaturedId: action.nodes[0] ? action.nodes[0].id : state.media.featuredId,
        newUrl: "",
        dragIndex: null,
      }),
    });
  }

  if (action.type === "SEO_LOADING") {
    return Object.assign({}, state, {
      seo: Object.assign({}, state.seo, { seoLoading: true, seoLoadError: null }),
    });
  }

  if (action.type === "SEO_LOADED") {
    return Object.assign({}, state, {
      seo: Object.assign({}, state.seo, {
        seoTitle: action.title,
        seoDescription: action.description,
        seoHandle: action.handle,
        origTitle: action.title,
        origDescription: action.description,
        origHandle: action.handle,
        seoLoaded: true,
        seoLoading: false,
        seoLoadError: null,
      }),
    });
  }

  if (action.type === "SEO_LOAD_ERROR") {
    return Object.assign({}, state, {
      seo: Object.assign({}, state.seo, {
        seoLoading: false,
        seoLoadError: action.error,
      }),
    });
  }

  if (action.type === "SEO_RESET_ERROR") {
    // Reset so the useEffect in SeoTab can try fetching again
    return Object.assign({}, state, {
      seo: Object.assign({}, state.seo, { seoLoaded: false, seoLoadError: null }),
    });
  }

  if (action.type === "SEO_TITLE_CHANGE") {
    return Object.assign({}, state, {
      seo: Object.assign({}, state.seo, { seoTitle: action.value }),
    });
  }

  if (action.type === "SEO_DESCRIPTION_CHANGE") {
    return Object.assign({}, state, {
      seo: Object.assign({}, state.seo, { seoDescription: action.value }),
    });
  }

  if (action.type === "SEO_HANDLE_CHANGE") {
    return Object.assign({}, state, {
      seo: Object.assign({}, state.seo, { seoHandle: action.value }),
    });
  }

  if (action.type === "SEO_RESET") {
    // Discard all SEO changes and go back to original values
    return Object.assign({}, state, {
      seo: Object.assign({}, state.seo, {
        seoTitle: state.seo.origTitle,
        seoDescription: state.seo.origDescription,
        seoHandle: state.seo.origHandle,
      }),
    });
  }

  if (action.type === "SEO_SAVED") {
    // After a successful save, update the original values
    return Object.assign({}, state, {
      seo: Object.assign({}, state.seo, {
        origTitle: state.seo.seoTitle,
        origDescription: state.seo.seoDescription,
        origHandle: state.seo.seoHandle,
      }),
    });
  }

  // If action type is unknown, return state unchanged
  return state;
}

// ─── isDirty CHECK ────────────────────────────────────────
// Returns true if the user has made any changes in either tab
// Save button is disabled when this returns false

function computeIsDirty(formState) {
  const media = formState.media;
  const seo = formState.seo;

  // Check if any new images were added
  const hasNewImages = media.images.some(function(img) {
    return img.isNew && !img.toDelete;
  });

  // Check if any existing images were removed
  const hasRemovedImages = media.images.some(function(img) {
    return img.toDelete && !img.isNew;
  });

  // Check if any alt texts changed
  const hasAltChanges = media.images.some(function(img) {
    if (img.isNew || img.toDelete) {
      return false;
    }
    const original = media.origImages.find(function(o) { return o.id === img.id; });
    return original && img.alt !== original.alt;
  });

  // Check if any images were reordered
  const hasReorder = media.images.some(function(img) {
    if (img.isNew || img.toDelete) {
      return false;
    }
    const original = media.origImages.find(function(o) { return o.id === img.id; });
    return original && img.position !== original.position;
  });

  // Check if the featured image changed (only for existing Shopify images)
  const hasFeaturedChange = (
    media.featuredId !== media.origFeaturedId &&
    media.featuredId !== null &&
    !media.featuredId.startsWith("new-")
  );

  const isMediaDirty = hasNewImages || hasRemovedImages || hasAltChanges || hasReorder || hasFeaturedChange;

  // Only check SEO if the SEO tab was opened (spec 1.5)
  // If SEO was never loaded, there can be no SEO changes
  let isSeoDirty = false;
  if (seo.seoLoaded) {
    isSeoDirty = (
      seo.seoTitle !== seo.origTitle ||
      seo.seoDescription !== seo.origDescription ||
      seo.seoHandle !== seo.origHandle
    );
  }

  return isMediaDirty || isSeoDirty;
}

// ─── PAGE COMPONENT ───────────────────────────────────────
// This is the main React component that renders the full edit page

export default function ProductEditor() {

  // Get the product data fetched by the loader
  const { product } = useLoaderData();

  // Read URL search params (e.g. ?saved=true after a redirect)
  const [searchParams, setSearchParams] = useSearchParams();

  // submit is used to send form data to the action
  const submit = useSubmit();

  // navigation.state tells us if a form submission is in progress
  const navigation = useNavigation();

  // actionData holds the result returned by the action after save
  const actionData = useActionData();

  // isSaving is true while the form is being submitted
  const isSaving = navigation.state === "submitting";

  // savedViaRedirect is true when user was redirected after changing the handle
  const savedViaRedirect = searchParams.get("saved") === "true";

  // Track which tab is currently active — starts on Media tab
  const [activeTab, setActiveTab] = useState("media");

  // formState holds ALL form data for both tabs
  // dispatch is the function used to update formState
  const [formState, dispatch] = useReducer(formReducer, product, createInitialState);

  // Clean up the ?saved=true from the URL after redirect
  // We do this after a short delay so the success banner has time to show
  if (typeof window !== "undefined" && searchParams.get("saved")) {
    setTimeout(function() {
      setSearchParams({}, { replace: true });
    }, 0);
  }

  // After a successful save, update form state with the fresh data from Shopify
  useEffect(function() {
    if (actionData && actionData.success) {
      if (actionData.updatedMedia) {
        dispatch({ type: "MEDIA_SAVED", nodes: actionData.updatedMedia });
      }
      if (actionData.seoSaved) {
        dispatch({ type: "SEO_SAVED" });
      }
    }
  }, [actionData]);

  // Compute whether the user has made any changes
  const isDirty = computeIsDirty(formState);

  // ── SAVE HANDLER ─────────────────────────────────────
  // Builds the form data from current state and submits it to the action
  function handleSave() {
    const media = formState.media;
    const seo = formState.seo;

    // Work out what changed in the Media tab
    const mediaUpdates = [];
    const removeIds = [];
    const newUrlImages = [];
    const newFileImages = [];
    const reorderMoves = [];

    media.images.forEach(function(img) {

      // New image added by URL or file
      if (img.isNew && !img.toDelete) {
        if (img.isFile && img.file) {
          newFileImages.push(img);
        } else {
          newUrlImages.push({ url: img.url, alt: img.alt });
        }
        return;
      }

      // Existing image marked for deletion
      if (img.toDelete && !img.isNew) {
        removeIds.push(img.id);
        return;
      }

      // Existing image that may have changed alt text or position
      const original = media.origImages.find(function(o) { return o.id === img.id; });
      if (original) {
        if (img.alt !== original.alt) {
          mediaUpdates.push({ id: img.id, alt: img.alt });
        }
        if (img.position !== original.position) {
          reorderMoves.push({ id: img.id, newPosition: String(img.position) });
        }
      }
    });

    // Check if the featured image changed
    const featuredChanged = (
      media.featuredId !== media.origFeaturedId &&
      media.featuredId !== null &&
      !media.featuredId.startsWith("new-")
    );

    // True if any media field changed
    const hasMediaChanges = (
      mediaUpdates.length > 0 ||
      removeIds.length > 0 ||
      newUrlImages.length > 0 ||
      newFileImages.length > 0 ||
      reorderMoves.length > 0 ||
      featuredChanged
    );

    // True if any SEO field changed (only when SEO tab was opened)
    let hasSeoChanges = false;
    if (seo.seoLoaded) {
      hasSeoChanges = (
        seo.seoTitle !== seo.origTitle ||
        seo.seoDescription !== seo.origDescription ||
        seo.seoHandle !== seo.origHandle
      );
    }

    // If nothing changed at all, do not submit (AC05 no-op)
    if (!hasMediaChanges && !hasSeoChanges) {
      return;
    }

    // Build the FormData to send to the action
    const formData = new FormData();
    formData.append("_tab", "both");
    formData.append("productId", product.id);
    formData.append("handle", product.handle);
    formData.append("hasMediaChanges", String(hasMediaChanges));
    formData.append("hasSeoChanges", String(hasSeoChanges));

    // Add media fields if there are media changes
    if (hasMediaChanges) {
      formData.append("featuredId", media.featuredId || "");
      formData.append("featuredChanged", featuredChanged ? "yes" : "no");
      formData.append("mediaUpdates", JSON.stringify(mediaUpdates));
      formData.append("reorderMoves", JSON.stringify(reorderMoves));
      removeIds.forEach(function(id) {
        formData.append("removeIds", id);
      });
      formData.append("newImages", JSON.stringify(newUrlImages));
      newFileImages.forEach(function(img, i) {
        formData.append("uploadFile_" + i, img.file);
        formData.append("uploadAlt_" + i, img.alt);
      });
      formData.append("uploadCount", String(newFileImages.length));
    }

    // Add SEO fields if there are SEO changes
    if (hasSeoChanges) {
      formData.append("seoTitle", seo.seoTitle);
      formData.append("seoDescription", seo.seoDescription);
      formData.append("seoHandle", seo.seoHandle);
      formData.append("origTitle", seo.origTitle);
      formData.append("origDescription", seo.origDescription);
      formData.append("origHandle", seo.origHandle);
    }

    // Submit everything to the action function
    submit(formData, { method: "post", encType: "multipart/form-data" });
  }

  // ── DISCARD HANDLER ───────────────────────────────────
  // Resets all form state back to what was originally loaded from Shopify
  function handleDiscard() {

    // Always reset media back to the original images
    dispatch({ type: "MEDIA_RESET", nodes: product.media.nodes });

    // Only reset SEO if the user actually opened the SEO tab
    // If they never opened it, there is nothing to reset (spec 1.5)
    if (formState.seo.seoLoaded) {
      dispatch({ type: "SEO_RESET" });
    }
  }

  // ── RENDER ────────────────────────────────────────────
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
      {/* Show Media tab content when Media tab is active */}
      {activeTab === "media" && (
        <MediaTab
          product={product}
          formState={formState}
          dispatch={dispatch}
        />
      )}

      {/* Show SEO tab content when SEO tab is active */}
      {/* SeoTab only mounts when first clicked = lazy load (AC07) */}
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

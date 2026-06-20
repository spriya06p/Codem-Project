import { useReducer, useState, useEffect } from "react";
import { useLoaderData, redirect, useSearchParams, useSubmit, useNavigation, useActionData } from "react-router";
import { authenticate } from "../shopify.server";
import MediaTab from "../components/MediaTab";
import SeoTab from "../components/SeoTab";
import ProductEditLayout from "../components/ProductEditLayout";
export async function loader({ request, params }) {
  let admin;
  try {
    const auth = await authenticate.admin(request);
    admin = auth.admin;
  } catch (error) {
    throw new Error("Unauthorized session");
  }
  const handle = params.handle;
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
    { variables: { handle: "handle:" + handle } }
  );

  const result = await response.json();
  const product = result.data.products.nodes[0];
  if (!product) {
    throw new Error("Product not found");
  }
  return { product };
}
export async function action({ request }) {
  let admin;
  try {
    const auth = await authenticate.admin(request);
    admin = auth.admin;
  } catch (error) {
    return { error: "Unauthorized session" };
  }
  const formData = await request.formData();
  const handle = formData.get("handle");
  if (!handle) {
    return { error: "Handle is required to update product" };
  }
  const productId = formData.get("productId");
  if (!productId) {
    return { error: "Invalid product payload" };
  }
  const tab = formData.get("_tab");
  const validTabs = ["media", "seo", "both"];
  if (!tab || !validTabs.includes(tab)) {
    return { error: "Unsupported tab" };
  }
  const hasMediaChanges = formData.get("hasMediaChanges") === "true";
  const hasSeoChanges = formData.get("hasSeoChanges") === "true";
  let updatedMedia = null;
  let seoSaved = false;
  let handleChanged = false;
  let newHandle = null;

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
      const file = formData.get("uploadFile_" + i);
      const alt = formData.get("uploadAlt_" + i) || "";
      if (file) {
        newFileImages.push({ file: file, alt: alt });
      }
    }

    try {
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
      if (newUrlImages.length > 0) {
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
        const existingFilenames = new Set();
        existingNodes.forEach(function(node) {
          try {
            const url = node.image.url;
            const filename = new URL(url).pathname.split("/").pop() || "";
            const cleanName = filename
              .replace(/_\d+x\d*(\.[^.]+)$/, "$1")
              .replace(/_master(\.[^.]+)$/, "$1")
              .toLowerCase();
            existingFilenames.add(cleanName);
          } catch (err) {
            // Skip this image if URL parsing fails
          }
        });

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
      for (let i = 0; i < newFileImages.length; i++) {
        const fileItem = newFileImages[i];
        const file = fileItem.file;
        const alt = fileItem.alt;
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
        const uploadForm = new FormData();
        target.parameters.forEach(function(param) {
          uploadForm.append(param.name, param.value);
        });
        uploadForm.append("file", file);

        const uploadRes = await fetch(target.url, { method: "POST", body: uploadForm });
        if (!uploadRes.ok) {
          return { error: "Unable to update product right now. Please try again." };
        }

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
          const isHandleError = errors.some(function(err) {
            return err.message.toLowerCase().includes("handle") || (err.field && err.field.includes("handle"));
          });

          if (isHandleError) {
            return { error: 'URL handle "' + newHandle + '" is already in use.', tab: "seo" };
          }

          return { error: "Unable to update product right now. Please try again." };
        }

        seoSaved = true;

      } catch (error) {
        return { error: "Unable to update product right now. Please try again." };
      }
    }
  }
  if (handleChanged && newHandle) {
    return redirect("/app/products/" + newHandle + "/edit?saved=true");
  }

  return {
    success: true,
    updatedMedia: updatedMedia,
    seoSaved: seoSaved,
  };
}
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
function buildInitialOrigImages(nodes) {
  return nodes.map(function(img, index) {
    return {
      id: img.id,
      alt: img.alt || "",
      position: index,
    };
  });
}
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
    const updatedImages = state.media.images.map(function(img) {
      if (img.id === action.id) {
        return Object.assign({}, img, { toDelete: true });
      }
      return img;
    });
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

    if (dragIndex === null || dragIndex === dropIndex) {
      return Object.assign({}, state, {
        media: Object.assign({}, state.media, { dragIndex: null }),
      });
    }

    const visibleImages = state.media.images.filter(function(img) {
      return !img.toDelete;
    });

    const reordered = visibleImages.slice();
    const movedImage = reordered.splice(dragIndex, 1)[0];
    reordered.splice(dropIndex, 0, movedImage);

    const withPositions = reordered.map(function(img, i) {
      return Object.assign({}, img, { position: i });
    });

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
    return Object.assign({}, state, {
      seo: Object.assign({}, state.seo, {
        seoTitle: state.seo.origTitle,
        seoDescription: state.seo.origDescription,
        seoHandle: state.seo.origHandle,
      }),
    });
  }

  if (action.type === "SEO_SAVED") {
    return Object.assign({}, state, {
      seo: Object.assign({}, state.seo, {
        origTitle: state.seo.seoTitle,
        origDescription: state.seo.seoDescription,
        origHandle: state.seo.seoHandle,
      }),
    });
  }

  return state;
}

function computeIsDirty(formState) {
  const media = formState.media;
  const seo = formState.seo;

  const hasNewImages = media.images.some(function(img) {
    return img.isNew && !img.toDelete;
  });

  const hasRemovedImages = media.images.some(function(img) {
    return img.toDelete && !img.isNew;
  });

  const hasAltChanges = media.images.some(function(img) {
    if (img.isNew || img.toDelete) {
      return false;
    }
    const original = media.origImages.find(function(o) { return o.id === img.id; });
    return original && img.alt !== original.alt;
  });

  const hasReorder = media.images.some(function(img) {
    if (img.isNew || img.toDelete) {
      return false;
    }
    const original = media.origImages.find(function(o) { return o.id === img.id; });
    return original && img.position !== original.position;
  });

  const hasFeaturedChange = (
    media.featuredId !== media.origFeaturedId &&
    media.featuredId !== null &&
    !media.featuredId.startsWith("new-")
  );

  const isMediaDirty = hasNewImages || hasRemovedImages || hasAltChanges || hasReorder || hasFeaturedChange;

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

  if (typeof window !== "undefined" && searchParams.get("saved")) {
    setTimeout(function() {
      setSearchParams({}, { replace: true });
    }, 0);
  }

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

  const isDirty = computeIsDirty(formState);
  function handleSave() {
    const media = formState.media;
    const seo = formState.seo;

    const mediaUpdates = [];
    const removeIds = [];
    const newUrlImages = [];
    const newFileImages = [];
    const reorderMoves = [];

    media.images.forEach(function(img) {

      if (img.isNew && !img.toDelete) {
        if (img.isFile && img.file) {
          newFileImages.push(img);
        } else {
          newUrlImages.push({ url: img.url, alt: img.alt });
        }
        return;
      }
      if (img.toDelete && !img.isNew) {
        removeIds.push(img.id);
        return;
      }
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
    const featuredChanged = (
      media.featuredId !== media.origFeaturedId &&
      media.featuredId !== null &&
      !media.featuredId.startsWith("new-")
    );
    const hasMediaChanges = (
      mediaUpdates.length > 0 ||
      removeIds.length > 0 ||
      newUrlImages.length > 0 ||
      newFileImages.length > 0 ||
      reorderMoves.length > 0 ||
      featuredChanged
    );
    let hasSeoChanges = false;
    if (seo.seoLoaded) {
      hasSeoChanges = (
        seo.seoTitle !== seo.origTitle ||
        seo.seoDescription !== seo.origDescription ||
        seo.seoHandle !== seo.origHandle
      );
    }
    if (!hasMediaChanges && !hasSeoChanges) {
      return;
    }
    const formData = new FormData();
    formData.append("_tab", "both");
    formData.append("productId", product.id);
    formData.append("handle", product.handle);
    formData.append("hasMediaChanges", String(hasMediaChanges));
    formData.append("hasSeoChanges", String(hasSeoChanges));
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
    if (hasSeoChanges) {
      formData.append("seoTitle", seo.seoTitle);
      formData.append("seoDescription", seo.seoDescription);
      formData.append("seoHandle", seo.seoHandle);
      formData.append("origTitle", seo.origTitle);
      formData.append("origDescription", seo.origDescription);
      formData.append("origHandle", seo.origHandle);
    }
    submit(formData, { method: "post", encType: "multipart/form-data" });
  }
  function handleDiscard() {
    dispatch({ type: "MEDIA_RESET", nodes: product.media.nodes });
    if (formState.seo.seoLoaded) {
      dispatch({ type: "SEO_RESET" });
    }
  }

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

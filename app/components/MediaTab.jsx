import { useRef, useEffect } from "react";
import PropTypes from "prop-types";
import "./MediaTab.css";

export default function MediaTab({ product, formState, dispatch }) {
  const images = formState.media.images;
  const featuredId = formState.media.featuredId;
  const newUrl = formState.media.newUrl;
  const fileStorageKey = "media_uploads_" + product.id;
  function getStoredUploads() {
    try {
      const raw = localStorage.getItem(fileStorageKey);
      return raw ? JSON.parse(raw) : [];
    } catch (err) {
      return [];
    }
  }
  const uploadedFileKeys = useRef(new Set());
  useEffect(() => {
    const stored = getStoredUploads();
    uploadedFileKeys.current = new Set(stored.map((item) => item.key));
  }, []);
  function registerUpload(filename, size) {
    const key = filename.toLowerCase() + "__" + size;
    uploadedFileKeys.current.add(key);
    try {
      const stored = getStoredUploads();
      const alreadySaved = stored.find((item) => item.key === key);
      if (!alreadySaved) {
        stored.push({ key: key });
        localStorage.setItem(fileStorageKey, JSON.stringify(stored));
      }
    } catch (err) {
      // localStorage may not be available in some browsers
    }
  }
  function unregisterUpload(filename, size) {
    const key = filename.toLowerCase() + "__" + size;
    uploadedFileKeys.current.delete(key);
    try {
      const stored = getStoredUploads().filter((item) => item.key !== key);
      localStorage.setItem(fileStorageKey, JSON.stringify(stored));
    } catch (err) {
      // localStorage may not be available in some browsers
    }
  }
  const urlStorageKey = "media_url_uploads_" + product.id;

  function getStoredUrls() {
    try {
      const raw = localStorage.getItem(urlStorageKey);
      return raw ? JSON.parse(raw) : [];
    } catch (err) {
      return [];
    }
  }

  const addedUrlKeys = useRef(new Set());

  useEffect(() => {
    const stored = getStoredUrls();
    addedUrlKeys.current = new Set(stored.map((item) => item.url.toLowerCase()));
  }, []);
  function registerUrl(url) {
    const normalized = url.trim().toLowerCase();
    addedUrlKeys.current.add(normalized);
    try {
      const stored = getStoredUrls();
      const alreadySaved = stored.find((item) => item.url.toLowerCase() === normalized);
      if (!alreadySaved) {
        stored.push({ url: url.trim() });
        localStorage.setItem(urlStorageKey, JSON.stringify(stored));
      }
    } catch (err) {
      // localStorage may not be available in some browsers
    }
  }

  function unregisterUrl(url) {
    const normalized = url.trim().toLowerCase();
    addedUrlKeys.current.delete(normalized);
    try {
      const stored = getStoredUrls().filter((item) => item.url.toLowerCase() !== normalized);
      localStorage.setItem(urlStorageKey, JSON.stringify(stored));
    } catch (err) {
      // localStorage may not be available in some browsers
    }
  }
  const visibleImages = images.filter((img) => img.toDelete === false);

  const atMaxImages = visibleImages.length >= 250;
  function handleAltChange(imageId, newValue) {
    dispatch({ type: "MEDIA_ALT_CHANGE", id: imageId, value: newValue });
  }
  function handleRemove(imageId) {
    if (imageId === featuredId && visibleImages.length === 1) {
      alert("At least one image is required before removing the featured image.");
      return;
    }

    const imageToRemove = images.find((img) => img.id === imageId);
    if (imageToRemove && imageToRemove.isFile && imageToRemove.file) {
      unregisterUpload(imageToRemove.file.name, imageToRemove.file.size);
    }
    if (imageToRemove && imageToRemove.isNew && imageToRemove.isFile === false) {
      unregisterUrl(imageToRemove.url);
    }

    dispatch({ type: "MEDIA_REMOVE", id: imageId });
  }
  function handleAddUrl() {
    if (!newUrl.trim()) {
      return;
    }
    if (atMaxImages) {
      alert("Maximum 250 images allowed.");
      return;
    }
    try {
      new URL(newUrl);
    } catch (err) {
      alert("Please enter a valid URL.");
      return;
    }

    const trimmed = newUrl.trim();
    const normalized = trimmed.toLowerCase();
    if (addedUrlKeys.current.has(normalized)) {
      alert("This image has already been added to this product.");
      return;
    }
    const alreadyInList = images.some(
      (img) => img.toDelete === false && img.url.toLowerCase() === normalized
    );
    if (alreadyInList) {
      alert("This image has already been added.");
      return;
    }
    registerUrl(trimmed);

    dispatch({ type: "MEDIA_ADD_URL", url: trimmed, alt: product.title });
  }
  function handleFileUpload(event) {
    const files = Array.from(event.target.files);

    if (files.length === 0) {
      return;
    }

    const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];

    files.forEach(function(file) {
      if (!allowedTypes.includes(file.type)) {
        alert(file.name + " is not supported. Use JPG, PNG, GIF or WebP.");
        return;
      }
      if (atMaxImages) {
        alert("Maximum 250 images allowed.");
        return;
      }
      const fileKey = file.name.toLowerCase() + "__" + file.size;
      if (uploadedFileKeys.current.has(fileKey)) {
        alert('"' + file.name + '" was already uploaded to this product.');
        return;
      }
      const alreadyPending = images.some(function(img) {
        return (
          img.toDelete === false &&
          img.isFile === true &&
          img.file &&
          img.file.name === file.name &&
          img.file.size === file.size
        );
      });

      if (alreadyPending) {
        alert('"' + file.name + '" has already been added.');
        return;
      }
      registerUpload(file.name, file.size);
      const previewUrl = URL.createObjectURL(file);

      dispatch({
        type: "MEDIA_ADD_FILE",
        file: file,
        previewUrl: previewUrl,
        alt: product.title,
      });
    });
    event.target.value = "";
  }
  function handleDragStart(index) {
    dispatch({ type: "MEDIA_DRAG_START", index: index });
  }
  function handleDrop(dropIndex) {
    dispatch({ type: "MEDIA_DRAG_DROP", dropIndex: dropIndex });
  }
  return (
    <div className="media-tab-wrapper">

      <h2>Media Management</h2>
      {atMaxImages && (
        <div className="max-warning">
          ⚠️ Maximum of 250 images reached. Remove an image before adding more.
        </div>
      )}
      <div className="add-section">
        <p className="add-section-title">Add Image</p>
        <p className="upload-label">Upload from computer:</p>
        <input
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          multiple
          disabled={atMaxImages}
          onChange={handleFileUpload}
        />
        <p className="hint-text">JPG, PNG, GIF, WebP supported.</p>
        <div className="or-divider">
          <hr />
          <span>OR</span>
          <hr />
        </div>
        <label htmlFor="url-input" className="url-label">Add by URL:</label>
        <div className="url-row">
          <input
            id="url-input"
            type="text"
            value={newUrl}
            placeholder="https://example.com/image.jpg"
            disabled={atMaxImages}
            onChange={(e) => dispatch({ type: "MEDIA_SET_NEW_URL", value: e.target.value })}
            onKeyDown={(e) => { if (e.key === "Enter") { handleAddUrl(); } }}
          />
          <button
            className="add-url-btn"
            disabled={atMaxImages}
            onClick={handleAddUrl}
          >
            Add
          </button>
        </div>
        <p className="image-count">{visibleImages.length}/250 images used.</p>
      </div>
      {visibleImages.length === 0 && (
        <p className="empty-message">No images. Add one above.</p>
      )}
      {visibleImages.length > 0 && (
        <div className="image-grid">
          {visibleImages.map((image, index) => (
            <div
              key={image.id}
              draggable
              onDragStart={() => handleDragStart(index)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(index)}
              className={"image-card" + (image.id === featuredId ? " is-featured" : "")}
            >
              {image.id === featuredId && (
                <span className="badge-featured">Featured</span>
              )}

              {image.isNew && (
                <span className="badge-new">New</span>
              )}

              <img
                src={image.url}
                alt={image.alt}
                onError={(e) => {
                  e.target.style.display = "none";
                  e.target.nextSibling.style.display = "flex";
                }}
              />
              <div className="image-fallback">Cannot preview</div>
              <label htmlFor={"alt-" + image.id} className="alt-label">
                Alt Text
              </label>
              <input
                id={"alt-" + image.id}
                type="text"
                value={image.alt}
                maxLength={512}
                placeholder="Describe this image..."
                className="alt-input"
                onChange={(e) => handleAltChange(image.id, e.target.value)}
              />
              <span className={"alt-counter" + (image.alt.length >= 500 ? " near-limit" : "")}>
                {image.alt.length}/512
              </span>
              <div className="card-buttons">
                {image.id !== featuredId && image.isNew === false && (
                  <button
                    className="btn-set-featured"
                    onClick={() => dispatch({ type: "MEDIA_SET_FEATURED", id: image.id })}
                  >
                    Set Featured
                  </button>
                )}
                <button
                  className="btn-remove"
                  onClick={() => handleRemove(image.id)}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

    </div>
  );
}

MediaTab.propTypes = {
  product: PropTypes.shape({
    id: PropTypes.string.isRequired,
    title: PropTypes.string.isRequired,
    handle: PropTypes.string.isRequired,
  }).isRequired,
  formState: PropTypes.object.isRequired,
  dispatch: PropTypes.func.isRequired,
};

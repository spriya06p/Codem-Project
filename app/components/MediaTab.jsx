import { useRef } from "react";
import PropTypes from "prop-types";

// ─── MEDIA TAB ────────────────────────────────────────────
// All state is managed by parent (route.jsx) via formState/dispatch.
// This component only renders UI and calls dispatch to update shared state.
// No local save button — Save/Discard live in ProductEditLayout (spec 1.5).

export default function MediaTab({ product, formState, dispatch }) {
  const { images, featuredId, newUrl } = formState.media;

  // localStorage helpers for file upload duplicate tracking
  const storageKey = `media_uploads_${product.id}`;
  const getStoredUploads = () => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  };

  const uploadedFileKeys = useRef(
    new Set(getStoredUploads().map((e) => e.key))
  );

  const registerUpload = (filename, size) => {
    const key = `${filename.toLowerCase()}__${size}`;
    uploadedFileKeys.current.add(key);
    try {
      const stored = getStoredUploads();
      if (!stored.find((e) => e.key === key)) {
        stored.push({ key, mediaId: null });
        localStorage.setItem(storageKey, JSON.stringify(stored));
      }
    } catch (_e) { return []; }
  };

  const unregisterUpload = (filename, size) => {
    const key = `${filename.toLowerCase()}__${size}`;
    uploadedFileKeys.current.delete(key);
    try {
      const stored = getStoredUploads().filter((e) => e.key !== key);
      localStorage.setItem(storageKey, JSON.stringify(stored));
    } catch (_e) {return [];}
  };

  // ── COMPUTED ──────────────────────────────────────────
  const visibleImages = images.filter((img) => !img.toDelete);
  const atMaxImages = visibleImages.length >= 250;

  // ── HANDLERS — dispatch to shared parent state ────────

  const handleAltChange = (id, value) => {
    dispatch({ type: "MEDIA_ALT_CHANGE", id, value });
  };

  // E-10: cannot remove the only featured image
  const handleRemove = (id) => {
    if (id === featuredId && visibleImages.length === 1) {
      alert("At least one image is required before removing the featured image.");
      return;
    }
    const img = images.find((i) => i.id === id);
    if (img?.isFile && img?.file) {
      unregisterUpload(img.file.name, img.file.size);
    }
    dispatch({ type: "MEDIA_REMOVE", id });
  };

  const handleAddUrl = () => {
    if (!newUrl.trim()) return;
    if (atMaxImages) {
      alert("Maximum 250 images allowed.");
      return;
    }
    try {
      new URL(newUrl);
    } catch {
      alert("Please enter a valid URL.");
      return;
    }
    const trimmed = newUrl.trim();
    const alreadyExists = images.some(
      (img) => !img.toDelete && img.url === trimmed
    );
    if (alreadyExists) {
      alert("This image has already been added.");
      return;
    }
    dispatch({ type: "MEDIA_ADD_URL", url: trimmed, alt: product.title });
  };

  const handleFileUpload = (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    const allowed = ["image/jpeg", "image/png", "image/gif", "image/webp"];

    files.forEach((file) => {
      if (!allowed.includes(file.type)) {
        alert(`${file.name} is not supported. Use JPG, PNG, GIF or WebP.`);
        return;
      }
      if (atMaxImages) {
        alert("Maximum 250 images allowed.");
        return;
      }
      const fileKey = `${file.name.toLowerCase()}__${file.size}`;
      if (uploadedFileKeys.current.has(fileKey)) {
        alert(`"${file.name}" was already uploaded to this product.`);
        return;
      }
      const alreadyPending = images.some(
        (img) =>
          !img.toDelete &&
          img.isFile &&
          img.file?.name === file.name &&
          img.file?.size === file.size
      );
      if (alreadyPending) {
        alert(`"${file.name}" has already been added.`);
        return;
      }
      const previewUrl = URL.createObjectURL(file);
      dispatch({ type: "MEDIA_ADD_FILE", file, previewUrl, alt: product.title });
    });
    e.target.value = "";
  };

  // Register files in localStorage when save is triggered
  // Called by parent before submit
  const registerAllPendingFiles = () => {
    images
      .filter((img) => img.isNew && !img.toDelete && img.isFile && img.file)
      .forEach((img) => registerUpload(img.file.name, img.file.size));
  };

  // Expose register function to parent via ref-like prop pattern
  // Parent calls this before submitting formData
  if (typeof formState.media._registerFiles === "function") {
    formState.media._registerFiles(registerAllPendingFiles);
  }

  // Drag to reorder
  const handleDragStart = (index) => {
    dispatch({ type: "MEDIA_DRAG_START", index });
  };

  const handleDrop = (dropIndex) => {
    dispatch({ type: "MEDIA_DRAG_DROP", dropIndex });
  };

  // const dragIndex = formState.media.dragIndex;

  // ── RENDER ────────────────────────────────────────────
  return (
    <div>
      <h2 style={{ margin: "0 0 20px", fontSize: "18px" }}>Media Management</h2>

      {/* Max images warning */}
      {atMaxImages && (
        <div style={{ background: "#fffbe6", border: "1px solid #ffe58f", borderRadius: "6px", padding: "10px 16px", marginBottom: "16px", color: "#ad6800", fontSize: "14px" }}>
          ⚠️ Maximum of 250 images reached. Remove an image before adding more.
        </div>
      )}

      {/* Add Image Section */}
      <div style={{ marginBottom: "24px", padding: "16px", background: "#f9f9f9", borderRadius: "8px", border: "1px solid #eee" }}>
        <p style={{ fontWeight: "600", fontSize: "14px", margin: "0 0 12px 0" }}>Add Image</p>

        <div style={{ marginBottom: "12px" }}>
          <p style={{ fontSize: "13px", color: "#555", marginBottom: "6px" }}>Upload from computer:</p>
          <input
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            multiple
            disabled={atMaxImages}
            onChange={handleFileUpload}
            style={{ fontSize: "14px", cursor: atMaxImages ? "not-allowed" : "pointer" }}
          />
          <p style={{ fontSize: "12px", color: "#999", marginTop: "4px" }}>JPG, PNG, GIF, WebP supported.</p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px", margin: "12px 0" }}>
          <hr style={{ flex: 1, border: "none", borderTop: "1px solid #ddd" }} />
          <span style={{ fontSize: "12px", color: "#aaa" }}>OR</span>
          <hr style={{ flex: 1, border: "none", borderTop: "1px solid #ddd" }} />
        </div>

        <div>
          <label htmlFor="url-input" style={{ fontSize: "13px", color: "#555", display: "block", marginBottom: "6px" }}>Add by URL:</label>
          <div style={{ display: "flex", gap: "8px" }}>
            <input
              id="url-input"
              type="text"
              value={newUrl}
              onChange={(e) => dispatch({ type: "MEDIA_SET_NEW_URL", value: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && handleAddUrl()}
              placeholder="https://example.com/image.jpg"
              disabled={atMaxImages}
              style={{ flex: 1, padding: "8px 12px", borderRadius: "6px", border: "1px solid #ccc", fontSize: "14px", opacity: atMaxImages ? 0.5 : 1 }}
            />
            <button
              onClick={handleAddUrl}
              disabled={atMaxImages}
              style={{ padding: "8px 18px", background: atMaxImages ? "#ccc" : "#333", color: "white", border: "none", borderRadius: "6px", cursor: atMaxImages ? "not-allowed" : "pointer", fontWeight: "600", fontSize: "14px" }}
            >
              Add
            </button>
          </div>
          <p style={{ fontSize: "12px", color: "#999", marginTop: "6px" }}>{visibleImages.length}/250 images used.</p>
        </div>
      </div>

      {/* Image Grid */}
      {visibleImages.length === 0 ? (
        <p style={{ color: "#666", textAlign: "center", padding: "40px" }}>No images. Add one above.</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "16px" }}>
          {visibleImages.map((image, index) => (
            <div
              key={image.id}
              draggable
              onDragStart={() => handleDragStart(index)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(index)}
              style={{ border: image.id === featuredId ? "2px solid #008060" : "1px solid #ddd", borderRadius: "8px", padding: "12px", background: "white", cursor: "grab", position: "relative" }}
            >
              {image.id === featuredId && (
                <span style={{ position: "absolute", top: "8px", left: "8px", background: "#008060", color: "white", fontSize: "11px", padding: "2px 8px", borderRadius: "10px", fontWeight: "600" }}>Featured</span>
              )}
              {image.isNew && (
                <span style={{ position: "absolute", top: "8px", right: "8px", background: "#0066cc", color: "white", fontSize: "11px", padding: "2px 8px", borderRadius: "10px", fontWeight: "600" }}>New</span>
              )}
              <img
                src={image.url}
                alt={image.alt}
                style={{ width: "100%", height: "160px", objectFit: "cover", borderRadius: "6px", marginBottom: "10px", marginTop: "24px" }}
                onError={(e) => { e.target.style.display = "none"; e.target.nextSibling.style.display = "flex"; }}
              />
              <div style={{ display: "none", width: "100%", height: "160px", background: "#f0f0f0", borderRadius: "6px", marginBottom: "10px", alignItems: "center", justifyContent: "center", color: "#999", fontSize: "13px" }}>Cannot preview</div>
              <label htmlFor={`alt-${image.id}`} style={{ fontSize: "12px", fontWeight: "600", display: "block", marginBottom: "4px" }}>Alt Text</label>
              <input
                id={`alt-${image.id}`}
                type="text"
                value={image.alt}
                maxLength={512}
                onChange={(e) => handleAltChange(image.id, e.target.value)}
                placeholder="Describe this image..."
                style={{ width: "100%", padding: "6px 10px", borderRadius: "5px", border: "1px solid #ccc", fontSize: "13px", boxSizing: "border-box", marginBottom: "4px" }}
              />
              <p style={{ fontSize: "11px", color: image.alt.length >= 500 ? "#cc0000" : "#aaa", margin: "0 0 10px" }}>{image.alt.length}/512</p>
              <div style={{ display: "flex", gap: "6px" }}>
                {image.id !== featuredId && !image.isNew && (
                  <button
                    onClick={() => dispatch({ type: "MEDIA_SET_FEATURED", id: image.id })}
                    style={{ flex: 1, padding: "5px", fontSize: "12px", background: "#f0f0f0", border: "1px solid #ccc", borderRadius: "5px", cursor: "pointer" }}
                  >
                    Set Featured
                  </button>
                )}
                <button
                  onClick={() => handleRemove(image.id)}
                  style={{ flex: 1, padding: "5px", fontSize: "12px", background: "#fff0f0", border: "1px solid #ffcccc", color: "#cc0000", borderRadius: "5px", cursor: "pointer" }}
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

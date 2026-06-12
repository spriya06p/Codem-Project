import { useState } from "react";
import { useSubmit, useActionData, useNavigation } from "react-router";

export default function MediaTab({ product }) {
  const submit = useSubmit();
  const actionData = useActionData();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  // ── STATE ──────────────────────────────────────────────
  const [images, setImages] = useState(
    product.media.nodes.map((img, index) => ({
      id: img.id,
      url: img.image?.url,
      alt: img.alt || product.title, // default alt = product title (spec)
      position: index,
      isNew: false,
      toDelete: false,
      isFile: false,
    }))
  );

  // Store originals for diff check
  const [origImages] = useState(
    product.media.nodes.map((img, index) => ({
      id: img.id,
      alt: img.alt || product.title,
      position: index,
    }))
  );

  // Track which URLs already exist in Shopify (for duplicate prevention)
  // We store Shopify image URLs so we never add the same URL twice
  const [existingShopifyUrls] = useState(
    new Set(
      product.media.nodes
        .map((img) => img.image?.url)
        .filter(Boolean)
    )
  );

  // Featured image — first image is default (spec)
  const [featuredId, setFeaturedId] = useState(
    product.media.nodes[0]?.id || null
  );
  const [origFeaturedId] = useState(product.media.nodes[0]?.id || null);

  const [newUrl, setNewUrl] = useState("");
  const [dragIndex, setDragIndex] = useState(null);

  // ── COMPUTED ───────────────────────────────────────────
  const visibleImages = images.filter((img) => !img.toDelete);
  const atMaxImages = visibleImages.length >= 250;

  // ── HANDLERS ──────────────────────────────────────────

  const handleAltChange = (id, value) => {
    setImages((prev) =>
      prev.map((img) => (img.id === id ? { ...img, alt: value } : img))
    );
  };

  // E-10: Cannot remove the only featured image
  const handleRemove = (id) => {
    if (id === featuredId && visibleImages.length === 1) {
      alert("At least one image is required before removing the featured image.");
      return;
    }
    setImages((prev) =>
      prev.map((img) => (img.id === id ? { ...img, toDelete: true } : img))
    );
    // Auto-assign next image as featured
    if (id === featuredId) {
      const next = visibleImages.find((img) => img.id !== id);
      if (next) setFeaturedId(next.id);
    }
  };

  // Add image by URL
  const handleAddUrl = () => {
    if (!newUrl.trim()) return;

    if (atMaxImages) {
      alert("Maximum 250 images allowed.");
      return;
    }

    // Validate URL format
    try {
      new URL(newUrl);
    } catch {
      alert("Please enter a valid URL.");
      return;
    }

    const trimmedUrl = newUrl.trim();

    // DUPLICATE CHECK 1: Already exists in Shopify
    if (existingShopifyUrls.has(trimmedUrl)) {
      alert("This image already exists in Shopify.");
      return;
    }

    // DUPLICATE CHECK 2: Already added in this session (not yet saved)
    const alreadyPending = images.some(
      (img) => img.isNew && !img.toDelete && img.url === trimmedUrl
    );
    if (alreadyPending) {
      alert("This image has already been added.");
      return;
    }

    setImages((prev) => [
      ...prev,
      {
        id: `new-${Date.now()}`,
        url: trimmedUrl,
        alt: product.title,
        position: prev.length,
        isNew: true,
        toDelete: false,
        isFile: false,
      },
    ]);
    setNewUrl("");
  };

  // Add image by file upload
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
      // Duplicate file check — same name + size = same file
      const alreadyExists = images.some(
        (img) =>
          img.isNew &&
          !img.toDelete &&
          img.isFile &&
          img.file?.name === file.name &&
          img.file?.size === file.size
      );
      if (alreadyExists) {
        alert(`"${file.name}" has already been added.`);
        return;
      }

      const previewUrl = URL.createObjectURL(file);
      setImages((prev) => [
        ...prev,
        {
          id: `new-${Date.now()}-${Math.random()}`,
          url: previewUrl,
          alt: product.title,
          position: prev.length,
          isNew: true,
          toDelete: false,
          isFile: true,
          file,
        },
      ]);
    });

    e.target.value = "";
  };

  // Drag to reorder
  const handleDragStart = (index) => setDragIndex(index);
  const handleDrop = (dropIndex) => {
    if (dragIndex === null || dragIndex === dropIndex) return;
    const updated = [...visibleImages];
    const [moved] = updated.splice(dragIndex, 1);
    updated.splice(dropIndex, 0, moved);
    const reordered = updated.map((img, i) => ({ ...img, position: i }));
    setImages((prev) => {
      const deleted = prev.filter((img) => img.toDelete);
      return [...reordered, ...deleted];
    });
    setDragIndex(null);
  };

  // ── SAVE WITH DIFF CHECK ───────────────────────────────
  const handleSave = () => {
    const mediaUpdates = [];
    const removeIds = [];
    const newUrlImages = [];
    const newFileImages = [];

    for (const img of images) {
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
      // Diff check — only include if alt or position changed
      const orig = origImages.find((o) => o.id === img.id);
      if (orig && (img.alt !== orig.alt || img.position !== orig.position)) {
        mediaUpdates.push({ id: img.id, alt: img.alt });
      }
    }

    // Featured changed only if it's an existing Shopify image
    const featuredChanged =
      featuredId !== origFeaturedId &&
      featuredId !== null &&
      !featuredId.startsWith("new-");

    // NO-OP: nothing changed — fire zero mutations (AC05)
    if (
      mediaUpdates.length === 0 &&
      removeIds.length === 0 &&
      newUrlImages.length === 0 &&
      newFileImages.length === 0 &&
      !featuredChanged
    ) {
      alert("No changes to save.");
      return;
    }

    const formData = new FormData();
    formData.append("_tab", "media");
    formData.append("productId", product.id);
    formData.append("handle", product.handle); // ← send REAL handle for E-02 check
    formData.append("featuredId", featuredId || "");
    formData.append("featuredChanged", featuredChanged ? "yes" : "no");
    formData.append("mediaUpdates", JSON.stringify(mediaUpdates));
    removeIds.forEach((id) => formData.append("removeIds", id));
    formData.append("newImages", JSON.stringify(newUrlImages));
    newFileImages.forEach((img, i) => {
      formData.append(`uploadFile_${i}`, img.file);
      formData.append(`uploadAlt_${i}`, img.alt);
    });
    formData.append("uploadCount", String(newFileImages.length));

    submit(formData, { method: "post", encType: "multipart/form-data" });
  };

  // ── RENDER ─────────────────────────────────────────────
  return (
    <div>
      {/* Header + Save */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
        <h2 style={{ margin: 0, fontSize: "18px" }}>Media Management</h2>
        <button
          onClick={handleSave}
          disabled={isSubmitting}
          style={{
            padding: "9px 24px",
            background: isSubmitting ? "#ccc" : "#008060",
            color: "white",
            border: "none",
            borderRadius: "6px",
            cursor: isSubmitting ? "not-allowed" : "pointer",
            fontWeight: "600",
            fontSize: "14px",
          }}
        >
          {isSubmitting ? "Saving..." : "Save Media"}
        </button>
      </div>

      {/* Success */}
      {actionData?.success && actionData?.tab === "media" && (
        <div style={{ background: "#f0fff4", border: "1px solid #b7ebc8", borderRadius: "6px", padding: "10px 16px", marginBottom: "16px", color: "#007a33", fontSize: "14px" }}>
          {actionData.noop ? "ℹ️ No changes to save." : "✅ Media saved successfully!"}
        </div>
      )}

      {/* Error */}
      {actionData?.error && actionData?.tab !== "seo" && (
        <div style={{ background: "#fff0f0", border: "1px solid #ffcccc", borderRadius: "6px", padding: "10px 16px", marginBottom: "16px", color: "#cc0000", fontSize: "14px" }}>
          ❌ {actionData.error}
        </div>
      )}

      {/* Max images warning */}
      {atMaxImages && (
        <div style={{ background: "#fffbe6", border: "1px solid #ffe58f", borderRadius: "6px", padding: "10px 16px", marginBottom: "16px", color: "#ad6800", fontSize: "14px" }}>
          ⚠️ Maximum 250 images reached. Remove one before adding more.
        </div>
      )}

      {/* Add Image Section */}
      <div style={{ marginBottom: "24px", padding: "16px", background: "#f9f9f9", borderRadius: "8px", border: "1px solid #eee" }}>
        <label style={{ fontWeight: "600", display: "block", marginBottom: "12px", fontSize: "14px" }}>
          Add Image
        </label>

        {/* File upload */}
        <div style={{ marginBottom: "12px" }}>
          <label style={{ fontSize: "13px", color: "#555", display: "block", marginBottom: "6px" }}>
            Upload from computer:
          </label>
          <input
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            multiple
            disabled={atMaxImages}
            onChange={handleFileUpload}
            style={{ fontSize: "14px", cursor: atMaxImages ? "not-allowed" : "pointer" }}
          />
          <p style={{ fontSize: "12px", color: "#999", marginTop: "4px" }}>
            JPG, PNG, GIF, WebP. Multiple files allowed.
          </p>
        </div>

        {/* Divider */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", margin: "12px 0" }}>
          <hr style={{ flex: 1, border: "none", borderTop: "1px solid #ddd" }} />
          <span style={{ fontSize: "12px", color: "#aaa" }}>OR</span>
          <hr style={{ flex: 1, border: "none", borderTop: "1px solid #ddd" }} />
        </div>

        {/* URL input */}
        <div>
          <label style={{ fontSize: "13px", color: "#555", display: "block", marginBottom: "6px" }}>
            Add by URL:
          </label>
          <div style={{ display: "flex", gap: "8px" }}>
            <input
              type="text"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddUrl()}
              placeholder="https://example.com/image.jpg"
              disabled={atMaxImages}
              style={{
                flex: 1,
                padding: "8px 12px",
                borderRadius: "6px",
                border: "1px solid #ccc",
                fontSize: "14px",
                opacity: atMaxImages ? 0.5 : 1,
              }}
            />
            <button
              onClick={handleAddUrl}
              disabled={atMaxImages}
              style={{
                padding: "8px 18px",
                background: atMaxImages ? "#ccc" : "#333",
                color: "white",
                border: "none",
                borderRadius: "6px",
                cursor: atMaxImages ? "not-allowed" : "pointer",
                fontWeight: "600",
                fontSize: "14px",
              }}
            >
              Add
            </button>
          </div>
          <p style={{ fontSize: "12px", color: "#999", marginTop: "6px" }}>
            {visibleImages.length}/250 images used.
          </p>
        </div>
      </div>

      {/* Image Grid */}
      {visibleImages.length === 0 ? (
        <p style={{ color: "#666", textAlign: "center", padding: "40px" }}>
          No images. Add one above.
        </p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "16px" }}>
          {visibleImages.map((image, index) => (
            <div
              key={image.id}
              draggable
              onDragStart={() => handleDragStart(index)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(index)}
              style={{
                border: image.id === featuredId ? "2px solid #008060" : "1px solid #ddd",
                borderRadius: "8px",
                padding: "12px",
                background: "white",
                cursor: "grab",
                position: "relative",
              }}
            >
              {/* Featured badge */}
              {image.id === featuredId && (
                <span style={{ position: "absolute", top: "8px", left: "8px", background: "#008060", color: "white", fontSize: "11px", padding: "2px 8px", borderRadius: "10px", fontWeight: "600" }}>
                  Featured
                </span>
              )}

              {/* New badge */}
              {image.isNew && (
                <span style={{ position: "absolute", top: "8px", right: "8px", background: "#0066cc", color: "white", fontSize: "11px", padding: "2px 8px", borderRadius: "10px", fontWeight: "600" }}>
                  New
                </span>
              )}

              {/* Image */}
              <img
                src={image.url}
                alt={image.alt}
                style={{ width: "100%", height: "160px", objectFit: "cover", borderRadius: "6px", marginBottom: "10px", marginTop: "24px" }}
                onError={(e) => {
                  e.target.style.display = "none";
                  e.target.nextSibling.style.display = "flex";
                }}
              />
              <div style={{ display: "none", width: "100%", height: "160px", background: "#f0f0f0", borderRadius: "6px", marginBottom: "10px", alignItems: "center", justifyContent: "center", color: "#999", fontSize: "13px" }}>
                Cannot preview
              </div>

              {/* Alt Text */}
              <label style={{ fontSize: "12px", fontWeight: "600", display: "block", marginBottom: "4px" }}>
                Alt Text
              </label>
              <input
                type="text"
                value={image.alt}
                maxLength={512}
                onChange={(e) => handleAltChange(image.id, e.target.value)}
                placeholder="Describe this image..."
                style={{ width: "100%", padding: "6px 10px", borderRadius: "5px", border: "1px solid #ccc", fontSize: "13px", boxSizing: "border-box", marginBottom: "4px" }}
              />
              <p style={{ fontSize: "11px", color: image.alt.length >= 500 ? "#cc0000" : "#aaa", margin: "0 0 10px" }}>
                {image.alt.length}/512
              </p>

              {/* Buttons */}
              <div style={{ display: "flex", gap: "6px" }}>
                {/* Set Featured — only for existing Shopify images */}
                {image.id !== featuredId && !image.isNew && (
                  <button
                    onClick={() => setFeaturedId(image.id)}
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

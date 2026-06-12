import { useState, useEffect } from "react";
import { useSubmit, useActionData, useNavigation } from "react-router";

// SEO Tab — lazy loaded when first clicked (AC07)
export default function SeoTab({ product }) {
  const submit = useSubmit();
  const actionData = useActionData();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [seoTitle, setSeoTitle] = useState("");
  const [seoDescription, setSeoDescription] = useState("");
  const [seoHandle, setSeoHandle] = useState("");
  const [original, setOriginal] = useState(null);

  // ── LAZY LOAD — only runs on first mount (AC07) ────────
  useEffect(() => {
    async function fetchSeoData() {
      try {
        setLoading(true);
        setLoadError(null);

        // FIX: use product.handle (not product.id) in the URL
        const res = await fetch(`/app/products/${product.handle}/seo-data`);

        if (!res.ok) {
          throw new Error("Unable to load SEO data right now. Please try again.");
        }

        const data = await res.json();

        // E-08: server returned an error object
        if (data.error) {
          throw new Error("Unable to load SEO data right now. Please try again.");
        }

        const title = data.seo?.title || "";
        const description = data.seo?.description || "";
        const handle = data.handle || "";

        setSeoTitle(title);
        setSeoDescription(description);
        setSeoHandle(handle);
        setOriginal({ title, description, handle });
      } catch {
        // E-08 exact message
        setLoadError("Unable to load SEO data right now. Please try again.");
      } finally {
        setLoading(false);
      }
    }

    fetchSeoData();
  }, []); // empty deps = only on first mount = lazy load (AC07)

  // ── DIFF CHECK ─────────────────────────────────────────
  const hasChanges =
    original !== null &&
    (seoTitle !== original.title ||
      seoDescription !== original.description ||
      seoHandle !== original.handle);

  // URL handle validation — lowercase letters, numbers, hyphens only (spec)
  const handleHandleChange = (value) => {
    setSeoHandle(value.toLowerCase().replace(/[^a-z-]/g, ""));
  };

  // ── SAVE ───────────────────────────────────────────────
  const handleSave = () => {
    if (!hasChanges) {
      alert("No changes to save.");
      return;
    }

    // Handle is required (spec) — block empty handle
    if (!seoHandle.trim()) {
      alert("URL handle is required.");
      return;
    }

    const formData = new FormData();
    formData.append("_tab", "seo");
    formData.append("productId", product.id);
    formData.append("handle", product.id); // E-02 check in action
    formData.append("seoTitle", seoTitle);
    formData.append("seoDescription", seoDescription);
    formData.append("seoHandle", seoHandle);
    formData.append("origTitle", original.title);
    formData.append("origDescription", original.description);
    formData.append("origHandle", original.handle);

    submit(formData, { method: "post" });
  };

  // ── LOADING ────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: "60px", color: "#666" }}>
        <p style={{ fontSize: "14px" }}>Loading SEO data...</p>
      </div>
    );
  }

  // ── E-08 ERROR ─────────────────────────────────────────
  if (loadError) {
    return (
      <div style={{ background: "#fff0f0", border: "1px solid #ffcccc", borderRadius: "6px", padding: "16px", color: "#cc0000", fontSize: "14px" }}>
        ❌ {loadError}
        <button
          onClick={() => window.location.reload()}
          style={{ marginLeft: "12px", padding: "4px 12px", fontSize: "13px", cursor: "pointer", borderRadius: "4px", border: "1px solid #cc0000", background: "white", color: "#cc0000" }}
        >
          Retry
        </button>
      </div>
    );
  }

  // ── RENDER ─────────────────────────────────────────────
  return (
    <div>
      {/* Header + Save */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
        <h2 style={{ margin: 0, fontSize: "18px" }}>SEO Settings</h2>
        <button
          onClick={handleSave}
          disabled={isSubmitting || !hasChanges}
          style={{
            padding: "9px 24px",
            background: !hasChanges || isSubmitting ? "#ccc" : "#008060",
            color: "white",
            border: "none",
            borderRadius: "6px",
            cursor: !hasChanges || isSubmitting ? "not-allowed" : "pointer",
            fontWeight: "600",
            fontSize: "14px",
          }}
        >
          {isSubmitting ? "Saving..." : "Save SEO"}
        </button>
      </div>

      {/* Success */}
      {actionData?.success && actionData?.tab === "seo" && (
        <div style={{ background: "#f0fff4", border: "1px solid #b7ebc8", borderRadius: "6px", padding: "10px 16px", marginBottom: "16px", color: "#007a33", fontSize: "14px" }}>
          ✅ SEO settings saved!
        </div>
      )}

      {/* Error — E-07 or E-09 */}
      {actionData?.error && actionData?.tab === "seo" && (
        <div style={{ background: "#fff0f0", border: "1px solid #ffcccc", borderRadius: "6px", padding: "10px 16px", marginBottom: "16px", color: "#cc0000", fontSize: "14px" }}>
          ❌ {actionData.error}
        </div>
      )}

      {/* Page Title — max 70 chars (spec) */}
      <div style={{ marginBottom: "20px" }}>
        <label style={{ fontWeight: "600", display: "block", marginBottom: "6px", fontSize: "14px" }}>
          Page Title <span style={{ color: "#999", fontWeight: "400" }}>(optional)</span>
        </label>
        <input
          type="text"
          value={seoTitle}
          maxLength={70}
          onChange={(e) => setSeoTitle(e.target.value)}
          placeholder="Product page title shown in Google..."
          style={{ width: "100%", padding: "9px 12px", borderRadius: "6px", border: "1px solid #ccc", fontSize: "14px", boxSizing: "border-box" }}
        />
        <p style={{ fontSize: "12px", color: seoTitle.length > 60 ? "#cc6600" : "#999", marginTop: "4px" }}>
          {seoTitle.length}/70 — shown as title in search results
        </p>
      </div>

      {/* Meta Description — max 320 chars (spec) */}
      <div style={{ marginBottom: "20px" }}>
        <label style={{ fontWeight: "600", display: "block", marginBottom: "6px", fontSize: "14px" }}>
          Meta Description <span style={{ color: "#999", fontWeight: "400" }}>(optional)</span>
        </label>
        <textarea
          value={seoDescription}
          maxLength={320}
          onChange={(e) => setSeoDescription(e.target.value)}
          placeholder="Short description shown under title in Google..."
          rows={4}
          style={{ width: "100%", padding: "9px 12px", borderRadius: "6px", border: "1px solid #ccc", fontSize: "14px", boxSizing: "border-box", resize: "vertical" }}
        />
        <p style={{ fontSize: "12px", color: seoDescription.length > 280 ? "#cc6600" : "#999", marginTop: "4px" }}>
          {seoDescription.length}/320 — shown as snippet in search results
        </p>
      </div>

      {/* URL Handle — required, lowercase + hyphens only (spec) */}
      <div style={{ marginBottom: "20px" }}>
        <label style={{ fontWeight: "600", display: "block", marginBottom: "6px", fontSize: "14px" }}>
          URL Handle <span style={{ color: "#cc0000", fontWeight: "400" }}>*required</span>
        </label>
        <input
          type="text"
          value={seoHandle}
          onChange={(e) => handleHandleChange(e.target.value)}
          placeholder="e.g. red-cotton-t-shirt"
          style={{
            width: "100%", padding: "9px 12px", borderRadius: "6px",
            border: !seoHandle.trim() ? "1px solid #cc0000" : "1px solid #ccc",
            fontSize: "14px", boxSizing: "border-box"
          }}
        />
        {!seoHandle.trim() && (
          <p style={{ fontSize: "12px", color: "#cc0000", marginTop: "4px" }}>
            URL handle is required.
          </p>
        )}
        <p style={{ fontSize: "12px", color: "#999", marginTop: "4px" }}>
          Lowercase letters, numbers, and hyphens only. Changing this creates a redirect.
        </p>
      </div>

      {/* Canonical URL — read only (spec) */}
      <div style={{ marginBottom: "28px" }}>
        <label style={{ fontWeight: "600", display: "block", marginBottom: "6px", fontSize: "14px" }}>
          Canonical URL <span style={{ color: "#999", fontWeight: "400" }}>(read only)</span>
        </label>
        <input
          type="text"
          value={`${product.onlineStoreUrl ? new URL(product.onlineStoreUrl).origin : "https://your-store.myshopify.com"}/products/${seoHandle}`}
          readOnly
          style={{ width: "100%", padding: "9px 12px", borderRadius: "6px", border: "1px solid #eee", fontSize: "14px", background: "#f5f5f5", color: "#888", boxSizing: "border-box" }}
        />
        <p style={{ fontSize: "12px", color: "#999", marginTop: "4px" }}>
          Auto-generated from handle — cannot be edited directly
        </p>
      </div>

      {!hasChanges && (
        <p style={{ fontSize: "12px", color: "#aaa" }}>Make a change above to enable saving.</p>
      )}
    </div>
  );
}

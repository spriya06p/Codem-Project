import { useEffect } from "react";
import PropTypes from "prop-types";

export default function SeoTab({ product, formState, dispatch }) {
  const { seoTitle, seoDescription, seoHandle, seoLoaded, seoLoading, seoLoadError } = formState.seo;
  useEffect(() => {
    if (seoLoaded) return;
    const controller = new AbortController();
    const signal = controller.signal;

    async function fetchSeoData() {
      dispatch({ type: "SEO_LOADING" });
      try {
        const res = await fetch(`/app/products/${product.handle}/seo-data`, { signal });
        if (signal.aborted) return;
        if (!res.ok) throw new Error("Unable to load SEO data right now. Please try again.");
        const data = await res.json();
        if (data.error) throw new Error("Unable to load SEO data right now. Please try again.");

        dispatch({
          type: "SEO_LOADED",
          title: data.seo?.title || "",
          description: data.seo?.description || "",
          handle: data.handle || "",
        });
      } catch (err) {
        if (err.name === "AbortError") return;
        dispatch({ type: "SEO_LOAD_ERROR", error: "Unable to load SEO data right now. Please try again." });
      }
    }

    fetchSeoData();
    return () => controller.abort();
  }, []);
  // URL handle — only allow lowercase letters, numbers, hyphens (spec)
  const handleHandleChange = (value) => {
    dispatch({ type: "SEO_HANDLE_CHANGE", value: value.toLowerCase().replace(/[^a-z0-9-]/g, "") });
  };

  // ── LOADING ────────────────────────────────────────────
  if (seoLoading) {
    return (
      <div style={{ textAlign: "center", padding: "60px", color: "#666" }}>
        <p style={{ fontSize: "14px" }}>Loading SEO data...</p>
      </div>
    );
  }

  // ── E-08 ERROR ─────────────────────────────────────────
  if (seoLoadError) {
    return (
      <div style={{ background: "#fff0f0", border: "1px solid #ffcccc", borderRadius: "6px", padding: "16px", color: "#cc0000", fontSize: "14px" }}>
        ❌ {seoLoadError}
        <button
          onClick={() => {
            dispatch({ type: "SEO_RESET_ERROR" });
          }}
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
      <h2 style={{ margin: "0 0 20px", fontSize: "18px" }}>SEO Settings</h2>

      {/* Page Title — max 70 chars (spec) */}
      <div style={{ marginBottom: "20px" }}>
        <label htmlFor="seo-title" style={{ fontWeight: "600", display: "block", marginBottom: "6px", fontSize: "14px" }}>
          Page Title <span style={{ color: "#999", fontWeight: "400" }}>(optional)</span>
        </label>
        <input
          id="seo-title"
          type="text"
          value={seoTitle}
          maxLength={70}
          onChange={(e) => dispatch({ type: "SEO_TITLE_CHANGE", value: e.target.value })}
          placeholder="Product page title shown in Google..."
          style={{ width: "100%", padding: "9px 12px", borderRadius: "6px", border: "1px solid #ccc", fontSize: "14px", boxSizing: "border-box" }}
        />
        <p style={{ fontSize: "12px", color: seoTitle.length > 60 ? "#cc6600" : "#999", marginTop: "4px" }}>
          {seoTitle.length}/70 — shown as title in search results
        </p>
      </div>

      {/* Meta Description — max 320 chars (spec) */}
      <div style={{ marginBottom: "20px" }}>
        <label htmlFor="seo-description" style={{ fontWeight: "600", display: "block", marginBottom: "6px", fontSize: "14px" }}>
          Meta Description <span style={{ color: "#999", fontWeight: "400" }}>(optional)</span>
        </label>
        <textarea
          id="seo-description"
          value={seoDescription}
          maxLength={320}
          onChange={(e) => dispatch({ type: "SEO_DESCRIPTION_CHANGE", value: e.target.value })}
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
        <label htmlFor="seo-handle" style={{ fontWeight: "600", display: "block", marginBottom: "6px", fontSize: "14px" }}>
          URL Handle <span style={{ color: "#cc0000", fontWeight: "400" }}>*required</span>
        </label>
        <input
          id="seo-handle"
          type="text"
          value={seoHandle}
          onChange={(e) => handleHandleChange(e.target.value)}
          placeholder="e.g. red-cotton-t-shirt"
          style={{
            width: "100%", padding: "9px 12px", borderRadius: "6px",
            border: !seoHandle.trim() ? "1px solid #cc0000" : "1px solid #ccc",
            fontSize: "14px", boxSizing: "border-box",
          }}
        />
        {!seoHandle.trim() && (
          <p style={{ fontSize: "12px", color: "#cc0000", marginTop: "4px" }}>URL handle is required.</p>
        )}
        <p style={{ fontSize: "12px", color: "#999", marginTop: "4px" }}>
          Lowercase letters, numbers, and hyphens only. Changing this creates a redirect.
        </p>
      </div>

      {/* Canonical URL — read only (spec) */}
      <div style={{ marginBottom: "28px" }}>
        <label htmlFor="canonical-url" style={{ fontWeight: "600", display: "block", marginBottom: "6px", fontSize: "14px" }}>
          Canonical URL <span style={{ color: "#999", fontWeight: "400" }}>(read only)</span>
        </label>
        <input
          id="canonical-url"
          type="text"
          value={`${product.onlineStoreUrl ? new URL(product.onlineStoreUrl).origin : "https://your-store.myshopify.com"}/products/${seoHandle}`}
          readOnly
          style={{ width: "100%", padding: "9px 12px", borderRadius: "6px", border: "1px solid #eee", fontSize: "14px", background: "#f5f5f5", color: "#888", boxSizing: "border-box" }}
        />
        <p style={{ fontSize: "12px", color: "#999", marginTop: "4px" }}>
          Auto-generated from handle — cannot be edited directly
        </p>
      </div>
    </div>
  );
}

SeoTab.propTypes = {
  product: PropTypes.shape({
    id: PropTypes.string.isRequired,
    handle: PropTypes.string.isRequired,
    onlineStoreUrl: PropTypes.string,
  }).isRequired,
  formState: PropTypes.object.isRequired,
  dispatch: PropTypes.func.isRequired,
};

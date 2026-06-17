import PropTypes from "prop-types";

// ─── SHARED LAYOUT COMPONENT ──────────────────────────────
// Renders the persistent header bar with Save and Discard buttons.
// Lives OUTSIDE the tab content area — always visible regardless of active tab.
// Shared/reusable across all four groups (spec 1.5).

export default function ProductEditLayout({
  product,
  activeTab,
  onTabChange,
  isDirty,
  isSaving,
  onSave,
  onDiscard,
  actionData,
  savedViaRedirect,
  children,
}) {
  return (
    <div style={{ fontFamily: "sans-serif", maxWidth: "960px", margin: "0 auto", padding: "24px" }}>

      {/* Page title */}
      <h1 style={{ marginBottom: "4px", fontSize: "22px" }}>Product Media & SEO</h1>
      <p style={{ color: "#666", marginBottom: "20px", fontSize: "14px" }}>
        Editing: <strong>{product.title}</strong>
      </p>

      {/* ── PERSISTENT HEADER BAR — Save + Discard ── */}
      {/* Always visible regardless of which tab is active (spec 1.5) */}
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "12px 16px",
        background: "#f9f9f9",
        border: "1px solid #ddd",
        borderRadius: "8px",
        marginBottom: "20px",
        position: "sticky",
        top: "0",
        zIndex: 10,
      }}>
        <div style={{ fontSize: "13px", color: isDirty ? "#cc6600" : "#999" }}>
          {isDirty ? "⚠️ You have unsaved changes" : "No unsaved changes"}
        </div>

        <div style={{ display: "flex", gap: "8px" }}>
          {/* Discard — reverts ALL form state across both tabs */}
          <button
            onClick={onDiscard}
            disabled={!isDirty || isSaving}
            style={{
              padding: "8px 20px",
              background: "white",
              color: !isDirty || isSaving ? "#aaa" : "#333",
              border: `1px solid ${!isDirty || isSaving ? "#ddd" : "#ccc"}`,
              borderRadius: "6px",
              cursor: !isDirty || isSaving ? "not-allowed" : "pointer",
              fontWeight: "600",
              fontSize: "14px",
            }}
          >
            Discard
          </button>

          {/* Save — disabled when nothing changed (spec 1.5) */}
          <button
            onClick={onSave}
            disabled={!isDirty || isSaving}
            style={{
              padding: "8px 24px",
              background: !isDirty || isSaving ? "#ccc" : "#008060",
              color: "white",
              border: "none",
              borderRadius: "6px",
              cursor: !isDirty || isSaving ? "not-allowed" : "pointer",
              fontWeight: "600",
              fontSize: "14px",
            }}
          >
            {isSaving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {/* Success after SEO handle redirect */}
      {savedViaRedirect && (
        <div style={{ background: "#f0fff4", border: "1px solid #b7ebc8", borderRadius: "6px", padding: "10px 16px", marginBottom: "16px", color: "#007a33", fontSize: "14px" }}>
          ✅ Changes saved successfully!
        </div>
      )}

      {/* Global success message */}
      {actionData?.success && !actionData?.noop && (
        <div style={{ background: "#f0fff4", border: "1px solid #b7ebc8", borderRadius: "6px", padding: "10px 16px", marginBottom: "16px", color: "#007a33", fontSize: "14px" }}>
          ✅ Changes saved successfully!
        </div>
      )}

      {/* Global error message */}
      {actionData?.error && (
        <div style={{ background: "#fff0f0", border: "1px solid #ffcccc", borderRadius: "6px", padding: "10px 16px", marginBottom: "16px", color: "#cc0000", fontSize: "14px" }}>
          ❌ {actionData.error}
        </div>
      )}

      {/* ── TAB BUTTONS — AC01: exactly 2 tabs ── */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "0" }}>
        <button
          onClick={() => onTabChange("media")}
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
          onClick={() => onTabChange("seo")}
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

      {/* Tab content area */}
      <div style={{ border: "1px solid #ddd", borderRadius: "0 6px 6px 6px", padding: "24px", background: "white" }}>
        {children}
      </div>
    </div>
  );
}

ProductEditLayout.propTypes = {
  product: PropTypes.shape({
    title: PropTypes.string.isRequired,
  }).isRequired,
  activeTab: PropTypes.string.isRequired,
  onTabChange: PropTypes.func.isRequired,
  isDirty: PropTypes.bool.isRequired,
  isSaving: PropTypes.bool.isRequired,
  onSave: PropTypes.func.isRequired,
  onDiscard: PropTypes.func.isRequired,
  actionData: PropTypes.object,
  savedViaRedirect: PropTypes.bool,
  children: PropTypes.node.isRequired,
};

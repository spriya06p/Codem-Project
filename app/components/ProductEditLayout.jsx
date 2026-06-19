import PropTypes from "prop-types";
import "./ProductEditLayout.css";
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
  const statusMessage = isDirty ? "⚠️ You have unsaved changes" : "No unsaved changes";
  const saveButtonLabel = isSaving ? "Saving..." : "Save";
  const buttonsDisabled = !isDirty || isSaving;

  return (
    <div className="layout-wrapper">
      <h1>Product Media &amp; SEO</h1>
      <p className="product-subtitle">
        Editing: <strong>{product.title}</strong>
      </p>
      <div className="save-bar">
        <span className={"save-bar-status" + (isDirty ? " has-changes" : "")}>
          {statusMessage}
        </span>

        <div className="save-bar-buttons">
          <button
            className="btn-discard"
            onClick={onDiscard}
            disabled={buttonsDisabled}
          >
            Discard
          </button>

          <button
            className="btn-save"
            onClick={onSave}
            disabled={buttonsDisabled}
          >
            {saveButtonLabel}
          </button>
        </div>
      </div>
      {savedViaRedirect && (
        <div className="banner-success">
          ✅ Changes saved successfully!
        </div>
      )}
      {actionData && actionData.success && !actionData.noop && (
        <div className="banner-success">
          ✅ Changes saved successfully!
        </div>
      )}
      {actionData && actionData.error && (
        <div className="banner-error">
          ❌ {actionData.error}
        </div>
      )}
      <div className="tab-buttons">
        <button
          className={"tab-btn" + (activeTab === "media" ? " active" : "")}
          onClick={() => onTabChange("media")}
        >
          Media
        </button>
        <button
          className={"tab-btn" + (activeTab === "seo" ? " active" : "")}
          onClick={() => onTabChange("seo")}
        >
          SEO
        </button>

      </div>
      <div className="tab-content">
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

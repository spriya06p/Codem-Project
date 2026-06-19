import { useEffect } from "react";
import PropTypes from "prop-types";
import "./SeoTab.css";

export default function SeoTab({ product, formState, dispatch }) {
    console.log("FORM STATE:", formState);
  const seoTitle = formState.seo.seoTitle;
  const seoDescription = formState.seo.seoDescription;
  const seoHandle = formState.seo.seoHandle;
  const seoLoaded = formState.seo.seoLoaded;
  const seoLoading = formState.seo.seoLoading;
  const seoLoadError = formState.seo.seoLoadError;
  function getStoreBaseUrl() {
    if (product.onlineStoreUrl) {
      return new URL(product.onlineStoreUrl).origin;
    }
    return "https://your-store.myshopify.com";
  }
  const canonicalUrl = getStoreBaseUrl() + "/products/" + seoHandle;
  useEffect(() => {
    if (seoLoaded) {
      return;
    }
    const controller = new AbortController();
    const signal = controller.signal;
    async function fetchSeoData() {
      dispatch({ type: "SEO_LOADING" });
      try {
        const response = await fetch(
          `/app/products/${product.handle}/seo-data`,
          { signal }
        );
        if (signal.aborted) {
          return;
        }
        if (!response.ok) {
          throw new Error("Server error");
        }

        const data = await response.json();
        if (data.error) {
          throw new Error(data.error);
        }
        dispatch({
          type: "SEO_LOADED",
          title: data.seo?.title || "",
          description: data.seo?.description || "",
          handle: data.handle || "",
        });

      } catch (err) {
        if (err.name === "AbortError") {
          return;
        }
        dispatch({
          type: "SEO_LOAD_ERROR",
          error: "Unable to load SEO data right now. Please try again.",
        });
      }
    }

    fetchSeoData();
    return () => {
      controller.abort();
    };

  }, []);
  function handleHandleChange(typedValue) {
    const lowercase = typedValue.toLowerCase();
    const cleaned = lowercase.replace(/[^a-z0-9-]/g, "");
    dispatch({ type: "SEO_HANDLE_CHANGE", value: cleaned });
  }
  if (seoLoading) {
    return (
      <div className="seo-tab-wrapper">
        <div className="loading-box">
          <p>Loading SEO data...</p>
        </div>
      </div>
    );
  }
  if (seoLoadError) {
    return (
      <div className="seo-tab-wrapper">
        <div className="error-box">
          ❌ {seoLoadError}
          <button onClick={() => dispatch({ type: "SEO_RESET_ERROR" })}>
            Retry
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="seo-tab-wrapper">

      <h2>SEO Settings</h2>
      <div className="form-field">
        <label htmlFor="seo-title">
          Page Title{" "}
          <span className="optional-text">(optional)</span>
        </label>

        <input
          id="seo-title"
          type="text"
          value={seoTitle}
          maxLength={70}
          placeholder="Product page title shown in Google..."
          onChange={(e) => dispatch({ type: "SEO_TITLE_CHANGE", value: e.target.value })}
        />
        <span className={seoTitle.length > 60 ? "hint-text-warning" : "hint-text"}>
          {seoTitle.length}/70 — shown as title in search results
        </span>
      </div>
      <div className="form-field">
        <label htmlFor="seo-description">
          Meta Description{" "}
          <span className="optional-text">(optional)</span>
        </label>

        <textarea
          id="seo-description"
          value={seoDescription}
          maxLength={320}
          rows={4}
          placeholder="Short description shown under title in Google..."
          onChange={(e) => dispatch({ type: "SEO_DESCRIPTION_CHANGE", value: e.target.value })}
        />
        <span className={seoDescription.length > 280 ? "hint-text-warning" : "hint-text"}>
          {seoDescription.length}/320 — shown as snippet in search results
        </span>
      </div>
      <div className="form-field">
        <label htmlFor="seo-handle">
          URL Handle{" "}
          <span className="required-text">*required</span>
        </label>
        <input
          id="seo-handle"
          type="text"
          value={seoHandle}
          placeholder="e.g. red-cotton-t-shirt"
          className={seoHandle.trim() === "" ? "input-error" : ""}
          onChange={(e) => handleHandleChange(e.target.value)}
        />
        {seoHandle.trim() === "" && (
          <span className="error-text">URL handle is required.</span>
        )}

        <span className="hint-text">
          Lowercase letters, numbers, and hyphens only. Changing this creates a redirect.
        </span>
      </div>
      <div className="form-field-last">
        <label htmlFor="canonical-url">
          Canonical URL{" "}
          <span className="optional-text">(read only)</span>
        </label>

        <input
          id="canonical-url"
          type="text"
          value={canonicalUrl}
          readOnly
          className="readonly-input"
        />

        <span className="hint-text">
          Auto-generated from handle — cannot be edited directly
        </span>
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

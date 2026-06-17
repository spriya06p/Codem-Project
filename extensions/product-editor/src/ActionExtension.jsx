import "@shopify/ui-extensions/preact";
import { APP_HANDLE } from "../config";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

// Admin Extension — injects Edit button into Shopify product page
// Target: admin.product-details.action.render (spec 1.3)

export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  const { close, data } = shopify;

  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  useEffect(() => {
    (async function fetchProduct() {
      try {
        setLoading(true);

        const res = await fetch("shopify:admin/api/graphql.json", {
          method: "POST",
          body: JSON.stringify({
            query: `
              query GetProduct($id: ID!) {
                product(id: $id) {
                  id
                  title
                  handle
                }
              }
            `,
            variables: { id: data.selected[0].id },
          }),
        });

        if (!res.ok) throw new Error("Network error");

        const json = await res.json();
        setProduct(json.data.product);
      } catch (err) {
        setError("Could not load product.");
      } finally {
        setLoading(false);
      }
    })();
  }, [data.selected]);
  const handleEdit = () => {
    if (!product) return;
    shopify.navigation.navigate(
      `/admin/apps/${APP_HANDLE}/app/products/${product.handle}/edit`
    );
    close();
  };

  return (
    <s-admin-action>
      <s-stack direction="block">
        {loading && <s-text>Loading product...</s-text>}
        {error && <s-text>{error}</s-text>}
        {product && (
          <>
            <s-text type="strong">{product.title}</s-text>
            <s-text>Handle: {product.handle}</s-text>
          </>
        )}
      </s-stack>

      {/* Primary action: Edit button */}
      <s-button
        slot="primary-action"
        disabled={!product || loading}
        onClick={handleEdit}
      >
        Edit Media & SEO
      </s-button>

      {/* Secondary action: Close */}
      <s-button
        slot="secondary-actions"
        onClick={() => close()}
      >
        Close
      </s-button>
    </s-admin-action>
  );
}

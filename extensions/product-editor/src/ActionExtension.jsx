import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  const { i18n, close, data, extension: { target } } = shopify;

  const [product, setProduct] = useState(null);

  useEffect(() => {
    (async function getProductInfo() {
      try {
        const getProductQuery = {
          query: `
            query Product($id: ID!) {
              product(id: $id) {
                id
                title
                handle
              }
            }
          `,
          variables: {
            id: data.selected[0].id,
          },
        };

        const res = await fetch(
          "shopify:admin/api/graphql.json",
          {
            method: "POST",
            body: JSON.stringify(getProductQuery),
          }
        );

        if (!res.ok) {
          console.error("Network Error");
          return;
        }

        const productData = await res.json();

        console.log(
          "PRODUCT DATA:",
          productData.data.product
        );

        setProduct(productData.data.product);
      } catch (error) {
        console.error(error);
      }
    })();
  }, [data.selected]);

 const handleEdit = () => {
  console.log("BUTTON CLICKED");

  const url =
    "https://YOUR-CLOUDFLARE-URL/app/product-editor?id=" +
    product.id;

  console.log(url);

  open(url);
};

  return (
    <s-admin-action>
      <s-stack direction="block">

        <s-text type="strong">
          {i18n.translate("welcome", { target })}
        </s-text>

        <s-text>
          Product Title:
          {" "}
          {product?.title || "Loading..."}
        </s-text>

        <s-text>
          Product Handle:
          {" "}
          {product?.handle || "Loading..."}
        </s-text>

      </s-stack>

     <s-button
  slot="primary-action"
  onClick={() => {
    window.open(
      "https://admin.shopify.com/store/cafe-a1oxf6lg/apps/codem-product-edit/app/product-editor",
      "_blank"
    );
  }}
>
  Edit Media & SEO
</s-button>

      <s-button
        slot="secondary-actions"
        onClick={() => close()}
      >
        Close
      </s-button>
    </s-admin-action>
  );
}

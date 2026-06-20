import { authenticate } from "../shopify.server";
export async function loader({ request, params }) {

  let admin;
  try {
    const auth = await authenticate.admin(request);
    admin = auth.admin;
  } catch (error) {
    const errorBody = JSON.stringify({
      error: "Unable to load SEO data right now. Please try again.",
    });
    return new Response(errorBody, {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const handle = params.handle;
  if (!handle) {
    const errorBody = JSON.stringify({
      error: "Unable to load SEO data right now. Please try again.",
    });
    return new Response(errorBody, {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  try {
    const response = await admin.graphql(
      `query ProductSeo($handle: String!) {
        products(first: 1, query: $handle) {
          nodes {
            id
            handle
            seo {
              title
              description
            }
          }
        }
      }`,
      { variables: { handle: "handle:" + handle } }
    );

    const result = await response.json();
    const product = result.data.products.nodes[0];
    if (!product) {
      const errorBody = JSON.stringify({
        error: "Unable to load SEO data right now. Please try again.",
      });
      return new Response(errorBody, {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    const seoTitle = product.seo ? product.seo.title : "";
    const seoDescription = product.seo ? product.seo.description : "";

    const responseBody = JSON.stringify({
      handle: product.handle,
      seo: {
        title: seoTitle || "",
        description: seoDescription || "",
      },
    });

    return new Response(responseBody, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  } catch (error) {
    const errorBody = JSON.stringify({
      error: "Unable to load SEO data right now. Please try again.",
    });
    return new Response(errorBody, {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

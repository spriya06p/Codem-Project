import { authenticate } from "../shopify.server";

// ─── SEO DATA LOADER ──────────────────────────────────────
// This is a separate route used only for lazy loading SEO data.
// It is called by SeoTab when the user clicks the SEO tab for the first time.
// URL: /app/products/:handle/seo-data
//
// Why a separate route?
// The main loader never fetches SEO data (AC07 - lazy load requirement).
// So SeoTab calls this route using fetch() to get SEO data on demand.

export async function loader({ request, params }) {

  // Step 1: Check if the user is logged into Shopify
  let admin;
  try {
    const auth = await authenticate.admin(request);
    admin = auth.admin;
  } catch (error) {
    // User is not authenticated — return E-08 error as JSON
    const errorBody = JSON.stringify({
      error: "Unable to load SEO data right now. Please try again.",
    });
    return new Response(errorBody, {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Step 2: Get the product handle from the URL
  // Example: /app/products/red-shirt/seo-data → handle = "red-shirt"
  const handle = params.handle;

  // If handle is missing, return E-08 error
  if (!handle) {
    const errorBody = JSON.stringify({
      error: "Unable to load SEO data right now. Please try again.",
    });
    return new Response(errorBody, {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Step 3: Ask Shopify for the product's SEO fields only
  // We only fetch id, handle, and seo — nothing else (keeps it lightweight)
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

    // If no product found, return E-08 error
    if (!product) {
      const errorBody = JSON.stringify({
        error: "Unable to load SEO data right now. Please try again.",
      });
      return new Response(errorBody, {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Step 4: Return the SEO data as JSON to SeoTab
    // SeoTab reads: data.handle, data.seo.title, data.seo.description
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
    // Something went wrong talking to Shopify — return E-08 error
    const errorBody = JSON.stringify({
      error: "Unable to load SEO data right now. Please try again.",
    });
    return new Response(errorBody, {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

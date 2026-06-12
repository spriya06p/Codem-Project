import { authenticate } from "../shopify.server";

// Lazy-load SEO data route — called only when SEO tab is first clicked (AC07)
// File: app/routes/app.products.$handle.seo-data.jsx

export async function loader({ request, params }) {
  let admin;
  try {
    const auth = await authenticate.admin(request);
    admin = auth.admin;
  } catch {
    return new Response(
      JSON.stringify({ error: "Unable to load SEO data right now. Please try again." }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  const { handle } = params;

  if (!handle) {
    return new Response(
      JSON.stringify({ error: "Unable to load SEO data right now. Please try again." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    // Use products query with handle filter — productByHandle is deprecated
    const response = await admin.graphql(
      `
      query ProductSeo($handle: String!) {
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
      }
      `,
      { variables: { handle: `handle:${handle}` } }
    );

    const result = await response.json();
    const product = result.data.products.nodes[0];

    if (!product) {
      return new Response(
        JSON.stringify({ error: "Unable to load SEO data right now. Please try again." }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    return Response.json({
      handle: product.handle,
      seo: {
        title: product.seo?.title || "",
        description: product.seo?.description || "",
      },
    });
  } catch {
    // E-08
    return new Response(
      JSON.stringify({ error: "Unable to load SEO data right now. Please try again." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

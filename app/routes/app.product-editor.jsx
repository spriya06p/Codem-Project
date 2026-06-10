import { useLoaderData,Form } from "react-router";
import { useState } from "react";
import { authenticate } from "../shopify.server";

export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);

  const url = new URL(request.url);

  const productId = url.searchParams.get("id");

  console.log("PRODUCT ID:", productId);

  if (!productId) {
    throw new Error("Product ID is required to load product");
  }

  const response = await admin.graphql(
    `
      query Product($id: ID!) {
        product(id: $id) {
          id
          title
          handle
          media(first: 50) {
            nodes {
              ... on MediaImage {
                id
                alt
                image {
                  url
                }
              }
            }
          }
        }
      }
    `,
    {
      variables: {
        id: productId,
      },
    }
  );

  const result = await response.json();

  console.log(
    "GRAPHQL RESULT:",
    JSON.stringify(result, null, 2)
  );

  const product = result.data.product;

  if (!product) {
    throw new Error("Product not found");
  }

  return { product };
}
export async function action({ request }) {
  const { admin } =
    await authenticate.admin(request);

  const formData = await request.formData();

  const mediaId =
    formData.get("mediaId");

  const altText =
    formData.get("altText");

  console.log("MEDIA ID:", mediaId);
  console.log("ALT:", altText);

  const response = await admin.graphql(
    `
    mutation UpdateAltText(
      $media: [UpdateMediaInput!]!
      $productId: ID!
    ) {
      productUpdateMedia(
        media: $media
        productId: $productId
      ) {
        media {
          alt
        }
        mediaUserErrors {
          field
          message
        }
      }
    }
    `,
    {
      variables: {
        productId:
          formData.get("productId"),

        media: [
          {
            id: mediaId,
            alt: altText,
          },
        ],
      },
    }
  );

  const result =
    await response.json();

  console.log(result);

  return null;
}
export default function ProductEditor() {
  const { product } = useLoaderData();

  const [images, setImages] = useState(
    product.media.nodes.map((img) => ({
      id: img.id,
      url: img.image?.url,
      altText: img.alt || "",
    }))
  );

  const [featuredId, setFeaturedId] = useState(
    product.media.nodes[0]?.id || null
  );

  function handleAltChange(id, value) {
    setImages(
      images.map((img) =>
        img.id === id
          ? { ...img, altText: value }
          : img
      )
    );
  }

  function handleUpload(event) {
    const files = [...event.target.files];

    const newImages = files.map((file) => ({
      id: Date.now() + Math.random(),
      url: URL.createObjectURL(file),
      altText: "",
      file,
    }));

    setImages([...images, ...newImages]);
  }

  function removeImage(id) {
    if (
      featuredId === id &&
      images.length === 1
    ) {
      alert(
        "At least one image is required before removing the featured image."
      );
      return;
    }

    const remaining = images.filter(
      (img) => img.id !== id
    );

    if (featuredId === id && remaining.length) {
      setFeaturedId(remaining[0].id);
    }

    setImages(remaining);
  }

  function moveUp(index) {
    if (index === 0) return;

    const updated = [...images];

    [updated[index - 1], updated[index]] = [
      updated[index],
      updated[index - 1],
    ];

    setImages(updated);
  }

  function moveDown(index) {
    if (index === images.length - 1) return;

    const updated = [...images];

    [updated[index + 1], updated[index]] = [
      updated[index],
      updated[index + 1],
    ];

    setImages(updated);
  }

  function saveChanges() {
    console.log("SAVE DATA");

    console.log(images);

    console.log(
      "Featured Image:",
      featuredId
    );

    alert(
      "UI working. Next step is Shopify mutations."
    );
  }

  return (
    <div style={{ padding: "20px" }}>
      <h1>Media Tab</h1>

      <h3>{product.title}</h3>

      <input
        type="file"
        multiple
        onChange={handleUpload}
      />

      <br />
      <br />

      {images.map((img, index) => (
        <div
          key={img.id}
          style={{
            border: "1px solid #ccc",
            padding: "15px",
            marginBottom: "15px",
          }}
        >
          <img
            src={img.url}
            alt={img.altText}
            width="200"
          />

          <br />
          <br />

          <label>
            <b>Alt Text</b>
          </label>

          <br />

       <Form method="post">

  <input
    type="hidden"
    name="productId"
    value={product.id}
  />

  <input
    type="hidden"
    name="mediaId"
    value={img.id}
  />

  <input
    type="text"
    name="altText"
    defaultValue={img.altText}
  />

  <button type="submit">
    Update Alt Text
  </button>

</Form>

          <br />
          <br />

          <input
            type="radio"
            checked={
              featuredId === img.id
            }
            onChange={() =>
              setFeaturedId(img.id)
            }
          />

          {" "}
          Featured Image

          <br />
          <br />

          <button
            onClick={() =>
              moveUp(index)
            }
          >
            Move Up
          </button>

          {" "}

          <button
            onClick={() =>
              moveDown(index)
            }
          >
            Move Down
          </button>

          {" "}

          <button
            onClick={() =>
              removeImage(img.id)
            }
          >
            Remove
          </button>
        </div>
      ))}

      <button
        onClick={saveChanges}
      >
        Save
      </button>
    </div>
  );
}


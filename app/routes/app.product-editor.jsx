import { useState } from "react";

export default function ProductEditor() {
  const [activeTab, setActiveTab] = useState("media");

  return (
    <div style={{ padding: "20px" }}>
      <h1>Product Editor</h1>

      <div>
        <button onClick={() => setActiveTab("media")}>
          Media
        </button>

        <button
          onClick={() => setActiveTab("seo")}
          style={{ marginLeft: "10px" }}
        >
          SEO
        </button>
      </div>

      <hr />

      {activeTab === "media" && (
        <div>
          <h2>Media Tab</h2>
          <p>Product images will come here.</p>
        </div>
      )}

      {activeTab === "seo" && (
        <div>
          <h2>SEO Tab</h2>

          <input
            type="text"
            placeholder="SEO Title"
          />

          <br /><br />

          <textarea
            placeholder="SEO Description"
            rows="5"
            cols="50"
          />
        </div>
      )}
    </div>
  );
}

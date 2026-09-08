const API = ""; // same-origin

// ---- Tabs ----
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
    if (btn.dataset.tab === "documents") loadDocuments();
    if (btn.dataset.tab === "relationships") loadRelationships();
  });
});

// ---- Upload ----
document.getElementById("upload-btn").addEventListener("click", async () => {
  const input = document.getElementById("file-input");
  const status = document.getElementById("upload-status");
  if (!input.files.length) {
    status.textContent = "Choose a PDF first.";
    return;
  }
  const formData = new FormData();
  formData.append("file", input.files[0]);
  status.textContent = "Uploading...";
  try {
    const res = await fetch(`${API}/documents`, { method: "POST", body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Upload failed");
    status.textContent = `Processing started (document_id=${data.document_id}). Check the "Documents & Facts" tab shortly — extraction runs in the background and can take a while on the free API tier.`;
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
  }
});

// ---- Documents & Facts ----
async function loadDocuments() {
  const list = document.getElementById("document-list");
  list.innerHTML = "<li>Loading...</li>";
  const res = await fetch(`${API}/documents`);
  const docs = await res.json();
  if (docs.length === 0) {
    list.innerHTML = '<li class="empty-state">No documents yet. Upload one first.</li>';
    return;
  }
  list.innerHTML = "";
  docs.forEach((doc) => {
    const li = document.createElement("li");
    li.innerHTML = `${escapeHtml(doc.filename)}<span class="status">${doc.status}${doc.page_count ? " · " + doc.page_count + "p" : ""}</span>`;
    li.addEventListener("click", () => {
      document.querySelectorAll("#document-list li").forEach((el) => el.classList.remove("active"));
      li.classList.add("active");
      loadFacts(doc.id, doc.filename);
    });
    list.appendChild(li);
  });
}

async function loadFacts(documentId, filename) {
  document.getElementById("fact-list-heading").textContent = `Facts — ${filename}`;
  const container = document.getElementById("facts-container");
  container.innerHTML = "Loading...";
  const res = await fetch(`${API}/documents/${documentId}/facts`);
  const facts = await res.json();
  if (facts.length === 0) {
    container.innerHTML = '<p class="empty-state">No facts extracted yet (processing may still be running, or this page produced none).</p>';
    return;
  }
  container.innerHTML = "";
  facts.forEach((f) => container.appendChild(factCard(f)));
}

function factCard(f) {
  const div = document.createElement("div");
  div.className = "fact-card";
  const valueDisplay = f.value !== null ? `${f.value}${f.unit ? " " + f.unit : ""}` : (f.value_text || "—");
  div.innerHTML = `
    <div class="metric">${escapeHtml(f.metric)}${f.metric_canonical ? ` <span style="font-weight:400;color:#888;font-size:12px;">(canonical: ${escapeHtml(f.metric_canonical)})</span>` : ""}</div>
    <div class="entity">${escapeHtml(f.entity)}</div>
    <div class="value">${escapeHtml(String(valueDisplay))}</div>
    <div class="meta">
      <span class="badge ${f.extraction_confidence}">${f.extraction_confidence} confidence</span>
      <span class="badge ${f.extraction_method}">${f.extraction_method}</span>
      <span>p.${f.source_page}</span>
      <span>${escapeHtml(f.time_scope.label)}</span>
      ${f.qualifiers.length ? `<span>${f.qualifiers.map(escapeHtml).join(", ")}</span>` : ""}
      ${f.has_visual_content ? '<span title="Numeric data was chart-only; text layer likely missed it">⚠ chart-only</span>' : ""}
    </div>
    <div class="quote">"${escapeHtml(f.source_quote)}"</div>
  `;
  return div;
}

// ---- Relationships ----
document.getElementById("rel-type-filter").addEventListener("change", loadRelationships);

async function loadRelationships() {
  const container = document.getElementById("relationships-container");
  container.innerHTML = "Loading...";
  const type = document.getElementById("rel-type-filter").value;
  const url = type ? `${API}/relationships?type=${type}` : `${API}/relationships`;
  const res = await fetch(url);
  const rels = await res.json();
  if (rels.length === 0) {
    container.innerHTML = '<p class="empty-state">No relationships found yet. Upload at least two documents with overlapping subject matter.</p>';
    return;
  }
  container.innerHTML = "";
  rels.forEach((r) => container.appendChild(relCard(r)));
}

function relCard(r) {
  const div = document.createElement("div");
  div.className = "rel-card";
  div.innerHTML = `
    <span class="rel-type ${r.relationship}">${r.relationship.replace(/_/g, " ")}</span>
    <span class="badge ${r.confidence}" style="margin-left:8px;">${r.confidence} confidence</span>
    <div class="rel-facts"></div>
    <div class="reasoning"><strong>Reasoning</strong>${escapeHtml(r.reasoning)}</div>
  `;
  const factsDiv = div.querySelector(".rel-facts");
  factsDiv.appendChild(factCard(r.fact_a));
  factsDiv.appendChild(factCard(r.fact_b));
  return div;
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

// initial load
loadDocuments();

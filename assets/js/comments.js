(function () {
  var list = document.getElementById("comment-list");
  var empty = document.getElementById("comment-empty");
  var form = document.getElementById("comment-form");
  if (!list || !form) return;

  var status = document.getElementById("comment-status");
  var postPath = window.location.pathname;

  function escapeHtml(text) {
    var div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  function renderComment(comment) {
    var item = document.createElement("li");
    item.className = "comment-item";
    var date = new Date(comment.created_at).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    item.innerHTML =
      '<p class="comment-meta"><span class="comment-author">' +
      escapeHtml(comment.author_name) +
      "</span> · " +
      date +
      '</p><p class="comment-body">' +
      escapeHtml(comment.body) +
      "</p>";
    list.appendChild(item);
  }

  async function loadComments() {
    var { data, error } = await window.supabaseClient
      .from("comments")
      .select("author_name, body, created_at")
      .eq("post_path", postPath)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Failed to load comments:", error);
      return;
    }

    if (!data || data.length === 0) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    data.forEach(renderComment);
  }

  form.addEventListener("submit", async function (event) {
    event.preventDefault();

    // Honeypot: real visitors never fill this hidden field.
    if (form.website.value.trim() !== "") {
      form.reset();
      return;
    }

    var name = form.name.value.trim();
    var body = form.body.value.trim();
    if (!name || !body) return;

    var submitButton = form.querySelector("button[type=submit]");
    submitButton.disabled = true;
    status.textContent = "Posting…";

    var { error } = await window.supabaseClient.from("comments").insert({
      post_path: postPath,
      author_name: name,
      body: body,
    });

    submitButton.disabled = false;

    if (error) {
      status.textContent = "Something went wrong — please try again.";
      return;
    }

    status.textContent = "Thanks! Your comment is awaiting approval and will appear once reviewed.";
    form.reset();
  });

  loadComments();
})();

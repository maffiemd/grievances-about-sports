(function () {
  var statusEl = document.getElementById("unsubscribe-status");
  var params = new URLSearchParams(window.location.search);
  var token = params.get("token");

  if (!token) {
    statusEl.textContent = "Missing unsubscribe link — please use the link from your email.";
    return;
  }

  window.supabaseClient
    .rpc("unsubscribe", { token: token })
    .then(function (result) {
      if (result.error) {
        statusEl.textContent = "Something went wrong — please try again or contact us.";
      } else {
        statusEl.textContent = "You've been unsubscribed. Sorry to see you go.";
      }
    });
})();

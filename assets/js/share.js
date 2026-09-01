(function () {
  var button = document.querySelector(".post-share-copy");
  if (!button) return;

  var defaultLabel = button.textContent;

  button.addEventListener("click", async function () {
    try {
      await navigator.clipboard.writeText(button.dataset.url);
      button.textContent = "Copied!";
    } catch (err) {
      button.textContent = "Couldn't copy";
    }
    setTimeout(function () {
      button.textContent = defaultLabel;
    }, 2000);
  });
})();

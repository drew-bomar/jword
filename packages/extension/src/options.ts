import { getJwordOrigin, normalizeOrigin, originPattern } from "./settings";

const input = document.querySelector<HTMLInputElement>("#jword-url")!;
const form = document.querySelector<HTMLFormElement>("form")!;
const status = document.querySelector<HTMLParagraphElement>("#status")!;

void getJwordOrigin().then((origin) => {
  input.value = origin;
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const origin = normalizeOrigin(input.value);
  if (!origin) {
    status.textContent = "Enter an http:// or https:// address, e.g. https://jword.example.com";
    return;
  }
  // Access to the jword site lets the background worker call jword's capture API with the
  // owner's session (decision 017). Chrome asks the owner to confirm.
  const granted = await chrome.permissions.request({ origins: [originPattern(origin)] });
  if (!granted) {
    status.textContent = "Permission was not granted, so the address was not saved.";
    return;
  }
  await chrome.storage.sync.set({ jwordUrl: origin });
  input.value = origin;
  status.textContent = `Saved. Captures are saved to ${origin}.`;
});

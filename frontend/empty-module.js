export default function fetch(...args) {
  return window.fetch(...args);
}

export const Headers = window.Headers;
export const Request = window.Request;
export const Response = window.Response;


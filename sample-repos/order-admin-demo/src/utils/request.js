const request = {
  get(url, options) {
    return fetch(url, { method: "GET", ...options }).then((res) => res.json());
  },
  post(url, body) {
    return fetch(url, {
      method: "POST",
      body: JSON.stringify(body)
    }).then((res) => res.json());
  }
};

export default request;

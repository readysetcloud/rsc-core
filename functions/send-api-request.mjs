import { getSecretValue } from "./utils/helpers.mjs";

export const handler = async (state) => {
  let authToken;
  if (state.secretKey) {
    authToken = await getSecretValue(state.secretKey);
    if (!authToken) {
      throw new Error('Unable to get secret');
    }
  }

  const config = configureRequest(state, authToken);
  const response = await fetch(config.url, config.options);
  if (!response.ok) {
    throw new Error(`HTTP error - Status: ${response.status}`);
  }
  const data = await response.json();
  return data;
};

const configureRequest = (state, authToken) => {
  let url = state.request.baseUrl;
  const headers = state.request.headers ?? {};

  if (state.auth) {
    let authValue = authToken;
    if (state.auth.prefix) {
      authValue = `${state.auth.prefix} ${authToken}`;
    }

    if (state.auth.location == 'query') {
      url = `${url}?${state.auth.key}=${authValue}`;
    } else if (state.auth.location == 'header') {
      headers[state.auth.key] = authValue;
    }
  }

  if (state.request.query) {
    const query = Object.entries(state.request.query).map(entry => `${entry[0]}=${entry[1]}`).join('&');
    if (url.includes('?')) {
      url = `${url}&${query}`;
    } else {
      url = `${url}?${query}`;
    }
  }

  const options = {
    method: state.request.method,
    headers,
  };

  if (state.request.body) {
    options.body = JSON.stringify(state.request.body);
    headers['Content-Type'] = 'application/json';
  }

  return { url, options };
};

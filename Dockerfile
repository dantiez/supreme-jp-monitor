# The server runs TypeScript directly through tsx, so there is no compile step
# and no build stage -- one would produce a second copy of the source whose
# only difference is that the types have been erased.
FROM node:22-slim

WORKDIR /app

# Dependencies first: rebuilt only when the manifests change, not on every edit.
COPY package.json package-lock.json ./
# --omit=dev is why tsx belongs in dependencies: it runs the server. Left in
# devDependencies this image builds cleanly and then dies with "tsx: not found".
RUN npm ci --omit=dev

COPY . .

# Cloud Run routes to the container by IP and injects PORT. 127.0.0.1 inside a
# container means the container itself, so nothing outside could ever reach it.
ENV HOST=0.0.0.0
ENV PORT=8080
EXPOSE 8080

CMD ["npm", "start"]

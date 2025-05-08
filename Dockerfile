# syntax=docker/dockerfile:1

ARG NODE_VERSION=21.7.3

FROM node:${NODE_VERSION}-alpine

# Changed to development environment for development
ENV NODE_ENV=development

WORKDIR /usr/src/app

# Install dependencies including dev dependencies (no --omit=dev)
RUN --mount=type=bind,source=package.json,target=package.json \
    --mount=type=bind,source=package-lock.json,target=package-lock.json \
    --mount=type=cache,target=/root/.npm \
    npm ci

# Remove or comment out this line for development
# USER node

# Copy the rest of the source files into the image.
COPY . .

# Expose the port that the application listens on.
EXPOSE 3000

# Run the application.
CMD ["npm", "start"]
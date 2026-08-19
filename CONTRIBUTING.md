# Contributing to Snapcast Manager

Thank you for your interest in contributing to Snapcast Manager! This guide will help you get started.

## Local Development Setup

For detailed setup instructions, see the [Local Development](README.md#-local-development) section in the README.

In brief:
- Clone the repository
- Install Node.js (requires version compatible with the project)
- Install dependencies and follow the setup steps in the README

## Running Tests and Linting

### Server Tests

From the `server/` directory:
```bash
cd server && npm test
```

### Linting

From the root directory:
```bash
npm run lint
```

To automatically fix formatting issues:
```bash
npm run format
```

## Commit Message Conventions

This project uses conventional commit messages. When committing, use one of these prefixes:

- `feat:` for new features (e.g., `feat: add radio stream support`)
- `fix:` for bug fixes (e.g., `fix: prevent config overwrite on update`)
- `chore:` for maintenance and version bumps (e.g., `chore: bump version to v0.2.0`)
- `docs:` for documentation updates (e.g., `docs: update README`)
- `ci:` for CI/CD changes (e.g., `ci: add test workflow`)

Example commit message:
```
feat: add myMPD management and player integration

Added support for myMPD as a music source alongside existing
radio streams and pipe sources. Includes new UI controls and
API endpoints for myMPD integration.
```

## Pull Request Process

1. **Branch from `main`**: Create a feature branch from the `main` branch
2. **Make your changes**: Implement your feature or fix
3. **Run tests and lint**: Ensure all tests pass and code follows the linting standards:
   ```bash
   cd server && npm test
   npm run lint
   ```
4. **Push and create a PR**: Push your branch and open a pull request to `main`
5. **CI checks must pass**: All GitHub Actions CI workflows (see `.github/workflows/ci.yml`) must pass before merging

## Code Organization

- **Server**: TypeScript backend in `server/src/`
- **Client**: Vue 3 frontend in `client/src/`

For significant changes to server functionality, ensure corresponding tests are added or updated.

## Questions?

Feel free to open an issue if you have questions or need clarification on any aspect of contributing.

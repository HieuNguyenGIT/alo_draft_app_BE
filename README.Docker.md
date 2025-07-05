# Alo Draft App Backend

## Getting Started with Docker

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed
- Git
- Access to the shared drive containing database backup

### Setup Instructions

1. Clone this repository:
   git clone [your-repository-url]
   cd alo_draft_app_BE

2. Download the database backup:

- Access the shared drive at [your-shared-drive-link]
- Download `db-data.tar.gz`
- Create a folder named `database-backup` in the project root
- Place the downloaded `db-data.tar.gz` file inside the `database-backup` folder

3. Restore the database: restore-db.bat

4. Start the application: docker compose up --build

Your application will be available at http://localhost:3003.

### API Endpoints

- GET /api/users - List all users
- POST /api/auth/login - Login with email and password
- GET /api/todos - List all todos
- [Add other endpoints as needed]

### For Flutter Developers

To connect your Flutter app to this backend:

```dart
// In your api_service.dart
static const String baseUrl = 'http://localhost:3003/api';

// For Android emulators, use:
// static const String baseUrl = 'http://10.0.2.2:3003/api';
```

# Error Codes

This document defines error codes returned by the starter-server API.

## Authentication & Authorization

- **401**: Unauthorized - Missing or invalid token
- **403**: Forbidden - Access denied or database permission error

## Input Validation

- **400**: Bad Request - Invalid input parameters
  - Missing required fields (username, password, email)
  - Invalid username format (must be 3-16 alphanumeric characters)
  - Invalid password length (must be 4-16 characters)
  - Invalid email format
  - Starter service not configured

## Account Management

- **409**: Conflict - Resource already exists
  - Username already exists
  - Email already in use

## Server Errors

- **500**: Internal Server Error - Unexpected server error

## Generic Error Response

```json
{
  "error": "An error occurred. Please try again later."
}
```

The API never exposes sensitive error details (database errors, system paths, etc.) to clients. All database or system errors are logged server-side and returned as error code 403 to the client.

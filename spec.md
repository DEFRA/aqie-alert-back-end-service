# User API Specifications

## 1. Setup Alert

**Endpoint:** `POST /setup-alert`

**Description:** Sets up alert notifications for a user with location and contact information.

**Request Body:**

```json
{
  "location": "string (required)",
  "user_contact": "string (required)",
  "emailAddress": "string (optional)",
  "templateId": "string (required)"
}
```

**Responses:**

- `200 OK` - Alert setup successful
  ```json
  {
    "success": true
  }
  ```
- `400 Bad Request` - Invalid input or validation error
- `500 Internal Server Error` - Server error

---

## 2. Opt-Out Alert (Phone)

**Endpoint:** `DELETE /opt-out-sms-alert`

**Description:** Removes a user from alert notifications using their phone number.

**Request Body:**

```json
{
  "phoneNumber": "string (required, UK format: 07XXXXXXXXX or +44XXXXXXXXXX)"
}
```

**Validation:**

- Phone number must start with `07` or `+44`
- Must be a valid UK phone number format

**Responses:**

- `200 OK` - User successfully opted out
  ```json
  {
    "success": true,
    "phoneNumber": "string"
  }
  ```
- `400 Bad Request` - Invalid phone number format
  ```json
  {
    "statusCode": 400,
    "error": "Bad Request",
    "message": "phoneNumber must be a valid UK number starting with 07 or +44"
  }
  ```
- `404 Not Found` - User not found
  ```json
  {
    "success": false,
    "error": "User not found"
  }
  ```
- `500 Internal Server Error` - Server error
  ```json
  {
    "success": false,
    "error": "Failed to opt-out"
  }
  ```

---

## 3. Opt-Out Email Alert

**Endpoint:** `DELETE /opt-out-email-alert`

**Description:** Removes a user from alert notifications using their email address.

**Request Body:**

```json
{
  "emailAddress": "string (required, valid email format)"
}
```

**Validation:**

- Email address must be in valid email format
- Email address is mandatory

**Responses:**

- `200 OK` - User successfully opted out
  ```json
  {
    "success": true
  }
  ```
- `403 Forbidden` - Invalid email format
  ```json
  {
    "statusCode": 403,
    "error": "Forbidden",
    "message": "Invalid email format"
  }
  ```
- `404 Not Found` - User not found
  ```json
  {
    "success": false,
    "error": "User not found"
  }
  ```
- `500 Internal Server Error` - Server error
  ```json
  {
    "success": false,
    "error": "Failed to opt-out"
  }
  ```

---

## Database Collection

**Collection Name:** `USERS`

**Schema:**

```javascript
{
  location: String,
  user_contact: String,      // Phone number
  emailAddress: String,       // Email address
  templateId: String,
  createdAt: Date
}
```

---

## Error Handling

All endpoints implement consistent error handling:

- Input validation errors return `400 Bad Request` or `403 Forbidden`
- Resource not found returns `404 Not Found`
- Server errors return `500 Internal Server Error`
- All sensitive data (phone numbers, emails) are masked in logs

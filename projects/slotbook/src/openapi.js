// OpenAPI 3.1 description of /api/v1. tests/unit/openapi.test.js checks that
// every route in the router is documented here and nothing extra is.

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema) => ({ content: { "application/json": { schema } } });
const ok = (schema, description = "OK") => ({ description, ...json(schema) });
const err = (description) => ({ description, ...json(ref("Error")) });
const bearer = [{ bearerAuth: [] }];
const idParam = { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } };
const pageParams = [
  { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
  { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
];
const common = { 401: err("Not signed in or token expired"), 422: err("Validation failed"), 429: err("Rate limited") };

export const openapi = {
  openapi: "3.1.0",
  info: {
    title: "Slotbook API",
    version: "1.0.0",
    description:
      "Appointment booking for small service businesses. All times are ISO 8601 in UTC; working hours are interpreted in the business time zone. Errors share one shape: `{ error: { code, message, details?, requestId } }`.",
  },
  servers: [{ url: "/api/v1" }],
  components: {
    securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
    schemas: {
      Error: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            type: "object",
            required: ["code", "message", "requestId"],
            properties: {
              code: { type: "string", examples: ["slot_taken"] },
              message: { type: "string" },
              details: {
                type: "array",
                items: { type: "object", properties: { field: { type: "string" }, message: { type: "string" } } },
              },
              requestId: { type: "string" },
            },
          },
        },
      },
      User: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          email: { type: "string", format: "email" },
          name: { type: "string" },
          phone: { type: ["string", "null"] },
          role: { enum: ["owner", "staff", "customer"] },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      Session: {
        type: "object",
        description: "A refresh token is also set as an HttpOnly cookie scoped to /api/v1/auth.",
        properties: {
          accessToken: { type: "string" },
          tokenType: { const: "Bearer" },
          expiresIn: { type: "integer" },
          user: ref("User"),
        },
      },
      Service: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          name: { type: "string" },
          description: { type: "string" },
          durationMin: { type: "integer" },
          priceCents: { type: "integer" },
          active: { type: "boolean" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      ServiceInput: {
        type: "object",
        required: ["name", "durationMin", "priceCents"],
        additionalProperties: false,
        properties: {
          name: { type: "string", maxLength: 80 },
          description: { type: "string", maxLength: 500 },
          durationMin: { type: "integer", minimum: 5, maximum: 480, multipleOf: 5 },
          priceCents: { type: "integer", minimum: 0, maximum: 1000000 },
        },
      },
      Staff: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          displayName: { type: "string" },
          bio: { type: "string" },
          active: { type: "boolean" },
          serviceIds: { type: "array", items: { type: "string", format: "uuid" } },
        },
      },
      Hours: {
        type: "object",
        properties: {
          weekday: { type: "integer", minimum: 1, maximum: 7, description: "1 = Monday" },
          start: { type: "string", examples: ["09:00"] },
          end: { type: "string", examples: ["13:00"] },
        },
      },
      Booking: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          status: { enum: ["confirmed", "cancelled", "completed", "no_show"] },
          startsAt: { type: "string", format: "date-time" },
          endsAt: { type: "string", format: "date-time" },
          priceCents: { type: "integer" },
          notes: { type: "string" },
          service: { type: "object", properties: { id: { type: "string" }, name: { type: "string" } } },
          staff: { type: "object", properties: { id: { type: "string" }, name: { type: "string" } } },
          customer: {
            type: "object",
            description: "Name and email are included for staff and the owner only.",
            properties: { id: { type: "string" }, name: { type: "string" }, email: { type: "string" } },
          },
          cancelledAt: { type: ["string", "null"], format: "date-time" },
          cancelReason: { type: ["string", "null"] },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      Page: {
        type: "object",
        properties: {
          page: { type: "integer" },
          limit: { type: "integer" },
          total: { type: "integer" },
          totalPages: { type: "integer" },
        },
      },
    },
  },
  paths: {
    "/health": {
      get: {
        summary: "Liveness and database check",
        responses: { 200: ok({ type: "object", properties: { status: { const: "ok" } } }) },
      },
    },
    "/openapi.json": { get: { summary: "This document", responses: { 200: ok({ type: "object" }) } } },
    "/auth/register": {
      post: {
        summary: "Create a customer account and sign in",
        requestBody: json({
          type: "object",
          required: ["email", "password", "name"],
          properties: {
            email: { type: "string" },
            password: { type: "string", minLength: 10 },
            name: { type: "string" },
            phone: { type: "string" },
          },
        }),
        responses: { 201: ok(ref("Session"), "Created"), 409: err("Email already registered"), ...common },
      },
    },
    "/auth/login": {
      post: {
        summary: "Sign in",
        requestBody: json({
          type: "object",
          required: ["email", "password"],
          properties: { email: { type: "string" }, password: { type: "string" } },
        }),
        responses: { 200: ok(ref("Session")), ...common },
      },
    },
    "/auth/refresh": {
      post: {
        summary: "Rotate the refresh cookie and get a new access token",
        description: "Reusing an already-rotated refresh token revokes every session from that login.",
        responses: { 200: ok(ref("Session")), 401: err("Missing, expired or reused refresh token") },
      },
    },
    "/auth/logout": { post: { summary: "Revoke this session", responses: { 204: { description: "Signed out" } } } },
    "/me": {
      get: { summary: "Current account", security: bearer, responses: { 200: ok(ref("User")), ...common } },
      patch: {
        summary: "Update name or phone",
        security: bearer,
        requestBody: json({
          type: "object",
          additionalProperties: false,
          properties: { name: { type: "string" }, phone: { type: ["string", "null"] } },
        }),
        responses: { 200: ok(ref("User")), ...common },
      },
      delete: {
        summary: "Delete my customer account and its bookings",
        security: bearer,
        requestBody: json({ type: "object", required: ["password"], properties: { password: { type: "string" } } }),
        responses: { 204: { description: "Deleted" }, 409: err("Staff and owner accounts are protected"), ...common },
      },
    },
    "/me/password": {
      post: {
        summary: "Change password and sign out other sessions",
        security: bearer,
        requestBody: json({
          type: "object",
          required: ["currentPassword", "newPassword"],
          properties: { currentPassword: { type: "string" }, newPassword: { type: "string", minLength: 10 } },
        }),
        responses: { 204: { description: "Changed" }, ...common },
      },
    },
    "/services": {
      get: {
        summary: "List services",
        description: "Public. The owner can also list archived services with status=archived or status=all.",
        parameters: [
          ...pageParams,
          { name: "q", in: "query", schema: { type: "string" }, description: "Search name and description" },
          { name: "sort", in: "query", schema: { enum: ["name", "price", "duration", "created"] } },
          { name: "order", in: "query", schema: { enum: ["asc", "desc"] } },
          { name: "status", in: "query", schema: { enum: ["active", "archived", "all"] } },
        ],
        responses: {
          200: ok({
            allOf: [ref("Page"), { type: "object", properties: { data: { type: "array", items: ref("Service") } } }],
          }),
          422: common[422],
        },
      },
      post: {
        summary: "Create a service (owner)",
        security: bearer,
        requestBody: json(ref("ServiceInput")),
        responses: { 201: ok(ref("Service"), "Created"), 403: err("Owner only"), ...common },
      },
    },
    "/services/{id}": {
      parameters: [idParam],
      get: { summary: "Get a service", responses: { 200: ok(ref("Service")), 404: err("Not found") } },
      patch: {
        summary: "Update a service (owner)",
        security: bearer,
        requestBody: json({
          type: "object",
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            durationMin: { type: "integer" },
            priceCents: { type: "integer" },
            active: { type: "boolean" },
          },
        }),
        responses: { 200: ok(ref("Service")), 403: err("Owner only"), 404: err("Not found"), ...common },
      },
      delete: {
        summary: "Archive a service (owner)",
        description: "Archived services keep their past bookings and can be reactivated with PATCH active=true.",
        security: bearer,
        responses: { 204: { description: "Archived" }, 403: err("Owner only"), 404: err("Not found") },
      },
    },
    "/staff": {
      get: {
        summary: "List staff",
        responses: { 200: ok({ type: "object", properties: { data: { type: "array", items: ref("Staff") } } }) },
      },
      post: {
        summary: "Make an existing account a staff member (owner)",
        security: bearer,
        requestBody: json({
          type: "object",
          required: ["email", "displayName"],
          properties: {
            email: { type: "string" },
            displayName: { type: "string" },
            bio: { type: "string" },
            serviceIds: { type: "array", items: { type: "string", format: "uuid" } },
          },
        }),
        responses: { 201: ok(ref("Staff"), "Created"), 404: err("No account with that email"), ...common },
      },
    },
    "/staff/{id}": {
      parameters: [idParam],
      patch: {
        summary: "Update a staff member (owner)",
        security: bearer,
        requestBody: json({
          type: "object",
          properties: {
            displayName: { type: "string" },
            bio: { type: "string" },
            active: { type: "boolean" },
            serviceIds: { type: "array", items: { type: "string" } },
          },
        }),
        responses: { 200: ok(ref("Staff")), 404: err("Not found"), ...common },
      },
    },
    "/staff/{id}/hours": {
      parameters: [idParam],
      get: {
        summary: "Weekly working hours",
        responses: { 200: ok({ type: "object", properties: { data: { type: "array", items: ref("Hours") } } }) },
      },
      put: {
        summary: "Replace weekly working hours (owner)",
        security: bearer,
        requestBody: json({
          type: "object",
          required: ["hours"],
          properties: { hours: { type: "array", items: ref("Hours") } },
        }),
        responses: {
          200: ok({ type: "object", properties: { data: { type: "array", items: ref("Hours") } } }),
          400: err("Overlapping or empty intervals"),
          ...common,
        },
      },
    },
    "/availability": {
      get: {
        summary: "Free slots for a service on a date",
        parameters: [
          { name: "serviceId", in: "query", required: true, schema: { type: "string", format: "uuid" } },
          { name: "date", in: "query", required: true, schema: { type: "string", format: "date" } },
          { name: "staffId", in: "query", schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          200: ok({
            type: "object",
            properties: {
              date: { type: "string" },
              timeZone: { type: "string" },
              durationMin: { type: "integer" },
              slots: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    staffId: { type: "string" },
                    staffName: { type: "string" },
                    startsAt: { type: "string", format: "date-time" },
                    endsAt: { type: "string", format: "date-time" },
                  },
                },
              },
            },
          }),
          404: err("Unknown service"),
          422: common[422],
        },
      },
    },
    "/bookings": {
      get: {
        summary: "List bookings visible to me",
        description: "Customers see their own bookings, staff see bookings with them, the owner sees all.",
        security: bearer,
        parameters: [
          ...pageParams,
          { name: "status", in: "query", schema: { enum: ["confirmed", "cancelled", "completed", "no_show"] } },
          { name: "from", in: "query", schema: { type: "string", format: "date" } },
          { name: "to", in: "query", schema: { type: "string", format: "date" } },
          { name: "staffId", in: "query", schema: { type: "string", format: "uuid" }, description: "Owner only" },
          { name: "sort", in: "query", schema: { enum: ["starts", "created"] } },
          { name: "order", in: "query", schema: { enum: ["asc", "desc"] } },
        ],
        responses: {
          200: ok({
            allOf: [ref("Page"), { type: "object", properties: { data: { type: "array", items: ref("Booking") } } }],
          }),
          ...common,
        },
      },
      post: {
        summary: "Book an appointment",
        security: bearer,
        requestBody: json({
          type: "object",
          required: ["serviceId", "staffId", "startsAt"],
          properties: {
            serviceId: { type: "string", format: "uuid" },
            staffId: { type: "string", format: "uuid" },
            startsAt: { type: "string", format: "date-time" },
            notes: { type: "string", maxLength: 500 },
          },
        }),
        responses: {
          201: ok(ref("Booking"), "Booked"),
          409: err("Slot taken, outside working hours, or overlaps another of your bookings"),
          ...common,
        },
      },
    },
    "/bookings/{id}": {
      parameters: [idParam],
      get: {
        summary: "Get one booking",
        security: bearer,
        responses: { 200: ok(ref("Booking")), 404: err("Not found or not yours"), ...common },
      },
    },
    "/bookings/{id}/cancel": {
      parameters: [idParam],
      post: {
        summary: "Cancel a booking",
        description: "Customers must cancel before the cutoff (default 120 minutes).",
        security: bearer,
        requestBody: json({ type: "object", properties: { reason: { type: "string", maxLength: 200 } } }),
        responses: { 200: ok(ref("Booking")), 409: err("Already closed or past the cutoff"), ...common },
      },
    },
    "/bookings/{id}/complete": {
      parameters: [idParam],
      post: {
        summary: "Mark as completed (staff or owner)",
        security: bearer,
        responses: { 200: ok(ref("Booking")), 409: err("Not started or already closed"), ...common },
      },
    },
    "/bookings/{id}/no-show": {
      parameters: [idParam],
      post: {
        summary: "Mark as no-show (staff or owner)",
        security: bearer,
        responses: { 200: ok(ref("Booking")), 409: err("Not started or already closed"), ...common },
      },
    },
  },
};

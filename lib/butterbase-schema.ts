interface SchemaDefinition {
  tables: Record<
    string,
    {
      columns: Record<
        string,
        {
          type: string;
          nullable?: boolean;
          default?: string;
          unique?: boolean;
          references?: string;
        }
      >;
      indexes?: Record<string, { columns: string[]; unique?: boolean }>;
    }
  >;
}

export const BUTTERBASE_TABLES = [
  "sessions",
  "questions",
  "purchases",
  "reports",
  "update_subscriptions",
] as const;

export const butterbaseSchema: SchemaDefinition = {
  tables: {
    sessions: {
      columns: {
        session_id: { type: "text", unique: true },
        user_id: { type: "text", nullable: true },
        idea: { type: "text" },
        tags: { type: "jsonb", nullable: true },
        status: { type: "text" },
        created_at: { type: "timestamptz" },
      },
      indexes: {
        sessions_user_idx: { columns: ["user_id"] },
        sessions_created_idx: { columns: ["created_at"] },
      },
    },
    questions: {
      columns: {
        session_id: { type: "text" },
        question: { type: "text" },
        cypher: { type: "text", nullable: true },
        answer: { type: "text" },
        created_at: { type: "timestamptz" },
      },
      indexes: {
        questions_session_idx: { columns: ["session_id"] },
        questions_created_idx: { columns: ["created_at"] },
      },
    },
    purchases: {
      columns: {
        session_id: { type: "text" },
        order_id: { type: "text", unique: true },
        status: { type: "text" },
        created_at: { type: "timestamptz" },
      },
      indexes: {
        purchases_session_status_idx: { columns: ["session_id", "status"] },
      },
    },
    reports: {
      columns: {
        session_id: { type: "text" },
        markdown: { type: "text" },
        created_at: { type: "timestamptz" },
      },
      indexes: {
        reports_session_created_idx: { columns: ["session_id", "created_at"] },
      },
    },
    update_subscriptions: {
      columns: {
        session_id: { type: "text", unique: true },
        user_id: { type: "text", nullable: true },
        email: { type: "text", nullable: true },
        industry: { type: "text" },
        cadence: { type: "text" },
        enabled: { type: "boolean" },
        last_sent_at: { type: "timestamptz", nullable: true },
        created_at: { type: "timestamptz" },
        updated_at: { type: "timestamptz" },
      },
      indexes: {
        updates_user_idx: { columns: ["user_id"] },
        updates_enabled_idx: { columns: ["enabled"] },
      },
    },
  },
};

// Executes the actual route/helper source with synthetic auth/DB/Storage adapters. No hosted writes.
const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  ts = require("typescript"),
  { createRequire } = require("node:module");
const root = path.resolve(__dirname, "../.."),
  requireRoot = createRequire(path.join(root, "package.json"));
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function harness({ realAI, realStorage, storageOrigin } = {}) {
  const state = {
    actor: uid(1),
    origin: "http://127.0.0.1",
    objects: new Map(),
    modelCalls: 0,
    formatCalls: 0,
    uploads: 0,
    failModel: false,
    delayModel: 0,
    requests: [],
    providerRequests: [],
  };
  class ApiAuthorizationError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  }
  const identity = async () => {
    if (!state.actor)
      throw new ApiAuthorizationError(401, "Authentication required.");
    return { user: { id: state.actor }, supabase: db };
  };
  function from(table) {
    const filters = {};
    const q = {
      select() {
        return q;
      },
      eq(k, v) {
        filters[k] = v;
        return q;
      },
      is(k, v) {
        filters[k] = v;
        return q;
      },
      in() {
        return q;
      },
      order() {
        return q;
      },
      maybeSingle() {
        return Promise.resolve(result(true));
      },
      then(resolve, reject) {
        return Promise.resolve(result(false)).then(resolve, reject);
      },
    };
    function result(single) {
      let rows =
        table === "providers"
          ? [
              { id: uid(2), user_id: uid(1), is_active: true },
              { id: uid(4), user_id: uid(3), is_active: true },
            ]
          : table === "report_drafts"
            ? [
                {
                  id: uid(5),
                  provider_id: uid(2),
                  patient_name: "Synthetic Fixture",
                  deleted_at: null,
                },
              ]
            : table === "universal_report_rules"
              ? [
                  {
                    report_type: "all",
                    rule_text:
                      "Preserve clinical facts, tooth numbers, measurements and negation. Use Australian English.",
                  },
                ]
              : [];
      rows = rows.filter((row) =>
        Object.entries(filters).every(([k, v]) => row[k] === v),
      );
      return { data: single ? rows[0] || null : rows, error: null };
    }
    return q;
  }
  const db = {
    from,
    storage: {
      from: () => ({
        createSignedUploadUrl: async (p) => ({
          data: { signedUrl: state.origin + "/storage/" + p },
          error: null,
        }),
        info: async (p) =>
          state.objects.has(p)
            ? { data: { size: state.objects.get(p).length }, error: null }
            : { data: null, error: { statusCode: "404" } },
        createSignedUrl: async (p) => ({
          data: { signedUrl: state.origin + "/download/" + p },
          error: null,
        }),
      }),
    },
  };
  if (realStorage) db.storage = realStorage;
  class AI {
    constructor() {
      this.audio = {
        transcriptions: {
          create: async (p, options) => {
            state.modelCalls++;
            state.providerRequests.push({
              stage: "transcription",
              model: p.model,
              prompt: p.prompt,
            });
            if (state.delayModel)
              await new Promise((r) => setTimeout(r, state.delayModel));
            if (state.failModel) throw Error("Synthetic provider failure");
            return realAI
              ? realAI.audio.transcriptions.create(p, options)
              : {
                  text: "Tooth one six has an eight millimetre pocket. No extraction is planned.",
                };
          },
        },
      };
      this.chat = {
        completions: {
          create: async (p, options) => {
            state.formatCalls++;
            state.providerRequests.push({ stage: "formatting", ...p });
            return realAI
              ? realAI.chat.completions.create(p, options)
              : {
                  choices: [
                    {
                      message: {
                        content:
                          "Tooth 16 has an 8mm pocket. No extraction is planned.",
                      },
                    },
                  ],
                };
          },
        },
      };
    }
  }
  const modules = {};
  function load(relative) {
    relative = relative.replace(/\.ts$/, "");
    if (modules[relative]) return modules[relative];
    const filename = path.join(root, relative + ".ts");
    const exports = {};
    modules[relative] = exports;
    const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText;
    const localRequire = (name) => {
      if (name === "server-only") return {};
      if (name === "@/lib/auth")
        return {
          ApiAuthorizationError,
          requireActiveApiUser: identity,
          sensitiveApiAccess: async () =>
            state.actor
              ? null
              : Response.json(
                  { success: false, error: "Authentication required." },
                  { status: 401 },
                ),
        };
      if (name === "@/lib/supabase/admin") return { supabaseAdmin: db };
      if (name === "@supabase/supabase-js") return { createClient: () => db };
      if (name === "next/server")
        return {
          NextResponse: { json: (data, init) => Response.json(data, init) },
        };
      if (name === "openai") return AI;
      if (name.startsWith("@/")) return load(name.slice(2));
      if (name.startsWith("."))
        return load(
          path.relative(root, path.resolve(path.dirname(filename), name)),
        );
      return requireRoot(name);
    };
    vm.runInNewContext(
      code,
      {
        exports,
        require: localRequire,
        process: {
          env: {
            OPENAI_API_KEY: "synthetic-adapter",
            NEXT_PUBLIC_SUPABASE_URL: "https://synthetic.invalid",
            SUPABASE_SERVICE_ROLE_KEY: "synthetic-signing-key",
          },
        },
        console: { log() {}, warn() {}, error() {} },
        Request,
        Response,
        File,
        Blob,
        FormData,
        Buffer,
        URL,
        Uint8Array,
        AbortSignal,
        Date,
        setTimeout,
        fetch: async (input, options) => {
          if (realStorage) {
            if (new URL(String(input)).origin !== storageOrigin)
              throw Error("Unexpected Storage origin");
            return fetch(input, options);
          }
          const pathname = new URL(String(input)).pathname;
          if (!pathname.startsWith("/download/"))
            throw Error("Unexpected network request");
          const bytes = state.objects.get(pathname.slice("/download/".length));
          return bytes
            ? new Response(bytes)
            : new Response("", { status: 404 });
        },
      },
      { filename },
    );
    return exports;
  }
  async function call(route, input, origin = state.origin) {
    const req = new Request(state.origin + route, {
      method: "POST",
      headers: { "Content-Type": "application/json", origin },
      body: JSON.stringify(input),
    });
    return load(
      route === "/api/report-writing/dictation-upload"
        ? "app/api/report-writing/dictation-upload/route"
        : "app/api/report-writing/transcribe/route",
    ).POST(req);
  }
  return { state, call, load, uid };
}
module.exports = { harness, uid };

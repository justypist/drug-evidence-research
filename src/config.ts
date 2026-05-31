import { e } from '#util/env.ts'

export const config = {
  openai: {
    baseUrl: e("OPENAI_BASE_URL", "https://api.openai.com/v1"),
    apiKey: e.required("OPENAI_API_KEY"),
    model: e.required("OPENAI_MODEL"),
  },
};

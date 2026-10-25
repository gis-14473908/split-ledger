export type AiErrorCode =
  | "unauthorized"
  | "bad_request"
  | "rate_limited"
  | "no_key"
  | "refused"
  | "invalid_output"
  | "upstream";

export const AI_ERROR_STATUS: Record<AiErrorCode, number> = {
  unauthorized: 401,
  bad_request: 400,
  rate_limited: 429,
  no_key: 500,
  refused: 422,
  invalid_output: 422,
  upstream: 502,
};

export const AI_ERROR_MESSAGE: Record<AiErrorCode, string> = {
  unauthorized: "请先登录",
  bad_request: "请求参数不正确",
  rate_limited: "操作太频繁，请一分钟后再试",
  no_key: "还没有配置 AI 密钥",
  refused: "AI 没有处理这张图片，请换一张试试",
  invalid_output: "没能识别出有效内容，请换一张更清楚的图片，或用 Opus 5.5 重试",
  upstream: "AI 服务暂时不可用，请稍后再试",
};

export class AiError extends Error {
  constructor(public code: AiErrorCode) {
    super(code);
    this.name = "AiError";
  }
}

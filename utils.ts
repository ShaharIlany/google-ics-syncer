import { addMilliseconds } from "date-fns";
import { getTimezoneOffset } from "date-fns-tz";

export const asiaJerusalem = (date: Date) => addMilliseconds(date, getTimezoneOffset("Asia/Jerusalem"))
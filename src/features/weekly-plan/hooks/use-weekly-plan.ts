import { useMutation, useQuery } from "@tanstack/react-query";
import type { WeeklyPlanRequest } from "@shared/contracts/weekly-plan";
import { getWeeklyPlanById, postWeeklyPlan } from "../weekly-plan-api.js";

export function weeklyPlanQueryKey(weeklyPlanId: string): readonly unknown[] {
  return ["weekly-plan", weeklyPlanId] as const;
}

export function useWeeklyPlan(accessToken: string, weeklyPlanId: string) {
  return useQuery({
    queryKey: weeklyPlanQueryKey(weeklyPlanId),
    queryFn: () => getWeeklyPlanById(accessToken, weeklyPlanId),
    enabled: weeklyPlanId.length > 0,
  });
}

export function useCreateWeeklyPlan(accessToken: string) {
  return useMutation({
    mutationFn: (body: WeeklyPlanRequest) => postWeeklyPlan(accessToken, body),
  });
}

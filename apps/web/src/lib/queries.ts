'use client';

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import type {
  AnalyticsDimension,
  AnalyticsSummary,
  AuditEvent,
  AuthUser,
  CompensationRecord,
  CorrectCompensationRequest,
  CreateCompensationRequest,
  CreateEmployeeRequest,
  CurrencyMode,
  DeactivateEmployeeRequest,
  DistributionResponse,
  EmployeeDetail,
  EmployeeListQuery,
  EmployeeSummary,
  HistogramResponse,
  ImportPreview,
  ImportUpload,
  LoginRequest,
  Paginated,
  ReactivateEmployeeRequest,
  RecentSalaryChange,
  ReferenceData,
  TrendsResponse,
  UpdateEmployeeRequest,
} from '@acme/shared';
import { api } from './api';

/** Query keys in one place so mutations invalidate exactly what they affect. */
export const keys = {
  me: ['auth', 'me'] as const,
  reference: ['reference-data'] as const,
  employees: ['employees'] as const,
  employeeList: (query: EmployeeListQuery) => ['employees', 'list', query] as const,
  employee: (id: string) => ['employees', 'detail', id] as const,
  compensations: (id: string) => ['employees', 'detail', id, 'compensations'] as const,
  audit: (id: string, page: number) => ['employees', 'detail', id, 'audit', page] as const,
  analytics: ['analytics'] as const,
  summary: ['analytics', 'summary'] as const,
  distribution: (dimension: AnalyticsDimension, mode: CurrencyMode) =>
    ['analytics', 'distribution', dimension, mode] as const,
  histogram: (currency: string | null) => ['analytics', 'histogram', currency] as const,
  trends: (months: number) => ['analytics', 'trends', months] as const,
  recentChanges: ['analytics', 'recent-changes'] as const,
};

// ---------- Auth ----------

export function useSession() {
  return useQuery({
    queryKey: keys.me,
    queryFn: ({ signal }) => api<{ user: AuthUser }>('/auth/me', { signal }).then((r) => r.user),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (credentials: LoginRequest) =>
      api<{ user: AuthUser }>('/auth/login', { method: 'POST', body: credentials }),
    onSuccess: ({ user }) => {
      queryClient.clear();
      queryClient.setQueryData(keys.me, user);
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>('/auth/logout', { method: 'POST' }),
    onSettled: () => queryClient.clear(),
  });
}

// ---------- Reference data ----------

export function useReferenceData() {
  return useQuery({
    queryKey: keys.reference,
    queryFn: ({ signal }) => api<ReferenceData>('/reference-data', { signal }),
    staleTime: 10 * 60_000,
  });
}

// ---------- Employees ----------

export function useEmployees(query: EmployeeListQuery) {
  return useQuery({
    queryKey: keys.employeeList(query),
    // The AbortSignal cancels superseded requests while the user is still typing or paging.
    queryFn: ({ signal }) =>
      api<Paginated<EmployeeSummary>>('/employees', { query: { ...query }, signal }),
    placeholderData: keepPreviousData,
  });
}

export function useEmployee(id: string) {
  return useQuery({
    queryKey: keys.employee(id),
    queryFn: ({ signal }) => api<EmployeeDetail>(`/employees/${id}`, { signal }),
  });
}

export function useCompensations(id: string) {
  return useQuery({
    queryKey: keys.compensations(id),
    queryFn: ({ signal }) =>
      api<{ data: CompensationRecord[] }>(`/employees/${id}/compensations`, { signal }).then(
        (r) => r.data,
      ),
  });
}

export function useAuditEvents(id: string, page: number) {
  return useQuery({
    queryKey: keys.audit(id, page),
    queryFn: ({ signal }) =>
      api<Paginated<AuditEvent>>(`/employees/${id}/audit-events`, {
        query: { page, pageSize: 10 },
        signal,
      }),
    placeholderData: keepPreviousData,
  });
}

/** After any write the affected employee, the lists and every analytic may have changed. */
function invalidateEmployee(queryClient: QueryClient, id?: string) {
  void queryClient.invalidateQueries({ queryKey: id ? keys.employee(id) : keys.employees });
  void queryClient.invalidateQueries({ queryKey: ['employees', 'list'] });
  void queryClient.invalidateQueries({ queryKey: keys.analytics });
}

export function useCreateEmployee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateEmployeeRequest) =>
      api<EmployeeDetail>('/employees', { method: 'POST', body }),
    onSuccess: (employee) => {
      queryClient.setQueryData(keys.employee(employee.id), employee);
      invalidateEmployee(queryClient);
    },
  });
}

export function useUpdateEmployee(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateEmployeeRequest) =>
      api<EmployeeDetail>(`/employees/${id}`, { method: 'PATCH', body }),
    onSuccess: (employee) => {
      queryClient.setQueryData(keys.employee(id), employee);
      invalidateEmployee(queryClient, id);
    },
  });
}

export function useDeactivateEmployee(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: DeactivateEmployeeRequest) =>
      api<EmployeeDetail>(`/employees/${id}/deactivate`, { method: 'POST', body }),
    onSuccess: (employee) => {
      queryClient.setQueryData(keys.employee(id), employee);
      invalidateEmployee(queryClient, id);
    },
  });
}

export function useReactivateEmployee(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ReactivateEmployeeRequest) =>
      api<EmployeeDetail>(`/employees/${id}/reactivate`, { method: 'POST', body }),
    onSuccess: (employee) => {
      queryClient.setQueryData(keys.employee(id), employee);
      invalidateEmployee(queryClient, id);
    },
  });
}

// ---------- Compensation ----------

export function useAddCompensation(employeeId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateCompensationRequest) =>
      api<CompensationRecord>(`/employees/${employeeId}/compensations`, { method: 'POST', body }),
    // Not optimistic: the server decides how neighbouring periods change (ADR-0003).
    onSuccess: () => invalidateEmployee(queryClient, employeeId),
  });
}

export function useCorrectCompensation(employeeId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: CorrectCompensationRequest & { id: string }) =>
      api<CompensationRecord>(`/employees/${employeeId}/compensations/${id}`, {
        method: 'PATCH',
        body,
      }),
    onSuccess: () => invalidateEmployee(queryClient, employeeId),
  });
}

// ---------- Analytics ----------

export function useSummary() {
  return useQuery({
    queryKey: keys.summary,
    queryFn: ({ signal }) => api<AnalyticsSummary>('/analytics/summary', { signal }),
  });
}

export function useDistribution(dimension: AnalyticsDimension, currencyMode: CurrencyMode) {
  return useQuery({
    queryKey: keys.distribution(dimension, currencyMode),
    queryFn: ({ signal }) =>
      api<DistributionResponse>('/analytics/distribution', {
        query: { dimension, currencyMode },
        signal,
      }),
    placeholderData: keepPreviousData,
  });
}

export function useHistogram(currency: string | null) {
  return useQuery({
    queryKey: keys.histogram(currency),
    queryFn: ({ signal }) =>
      api<HistogramResponse>('/analytics/histogram', { query: { currency }, signal }),
    placeholderData: keepPreviousData,
  });
}

export function useTrends(months = 24) {
  return useQuery({
    queryKey: keys.trends(months),
    queryFn: ({ signal }) =>
      api<TrendsResponse>('/analytics/trends', { query: { months }, signal }),
  });
}

export function useRecentChanges() {
  return useQuery({
    queryKey: keys.recentChanges,
    queryFn: ({ signal }) =>
      api<{ data: RecentSalaryChange[] }>('/analytics/recent-changes', {
        query: { limit: 8 },
        signal,
      }).then((r) => r.data),
  });
}

// ---------- Imports ----------

export function useUploadImport() {
  return useMutation({
    mutationFn: (body: ImportUpload) => api<ImportPreview>('/imports', { method: 'POST', body }),
  });
}

export function useCommitImport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<ImportPreview & { importedRows: number }>(`/imports/${id}/commit`, { method: 'POST' }),
    onSuccess: () => invalidateEmployee(queryClient),
  });
}

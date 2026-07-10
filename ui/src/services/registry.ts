import serviceRegistryJson from '../../service-registry.json';

export interface RscService {
  id: string;
  name: string;
  href: string;
  description?: string;
  shortName?: string;
  category?: string;
  iconUrl?: string;
  external?: boolean;
  active?: boolean;
  requiredEntitlements?: string[];
  allowedRoles?: string[];
}

export interface RscServiceRegistry {
  services: RscService[];
}

export interface RscServiceAccess {
  serviceIds?: readonly string[];
  entitlements?: readonly string[];
  roles?: readonly string[];
}

export const readySetCloudServiceRegistry = serviceRegistryJson satisfies RscServiceRegistry;
export const readySetCloudServices = readySetCloudServiceRegistry.services;

export function defineServiceRegistry(registry: RscServiceRegistry): RscServiceRegistry {
  return registry;
}

export function getVisibleServices(
  services: readonly RscService[],
  access?: RscServiceAccess
): RscService[] {
  return services.filter((service) => isServiceVisible(service, access));
}

export function isServiceVisible(service: RscService, access?: RscServiceAccess): boolean {
  if (service.active === false) return false;

  if (access?.serviceIds?.includes(service.id)) return true;

  const hasEntitlements = hasRequiredValues(service.requiredEntitlements, access?.entitlements);
  const hasRoles = hasRequiredValues(service.allowedRoles, access?.roles);

  return hasEntitlements && hasRoles;
}

function hasRequiredValues(required: readonly string[] | undefined, available: readonly string[] | undefined) {
  if (!required?.length) return true;
  if (!available?.length) return false;
  return required.every((value) => available.includes(value));
}

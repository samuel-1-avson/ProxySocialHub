import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const routesFile = path.join(projectRoot, "src", "lib", "navigation", "routes.ts");
const navigationFile = path.join(projectRoot, "src", "lib", "navigation", "nav.ts");
const policiesFile = path.join(projectRoot, "src", "lib", "navigation", "policies.ts");
const middlewareFile = path.join(projectRoot, "src", "middleware.ts");
const appDir = path.join(projectRoot, "src", "app");

const source = readFileSync(routesFile, "utf8");
const navigationSource = readFileSync(navigationFile, "utf8");
const policiesSource = readFileSync(policiesFile, "utf8");
const middlewareSource = readFileSync(middlewareFile, "utf8");
const routesObjectSource = source.match(/export const ROUTES = \{([\s\S]*?)\} as const;/)?.[1] ?? "";
const policiesObjectSource = policiesSource.match(/export const ROUTE_POLICIES:[\s\S]*?= \{([\s\S]*?)\};/)?.[1] ?? "";
const routeMatches = [...routesObjectSource.matchAll(/\b([a-zA-Z0-9_]+):\s*"([^"]+)"/g)];
const dynamicRouteMatches = [...routesObjectSource.matchAll(/\b([a-zA-Z0-9_]+):\s*\([^)]*\)\s*=>/g)];
const routesByKey = new Map(routeMatches.map(([, routeName, routePath]) => [routeName, routePath]));
for (const [, routeName] of dynamicRouteMatches) {
    routesByKey.set(routeName, `(dynamic:${routeName})`);
}
const missingPages = [];
let validatedCount = 0;

for (const [, routeName, routePath] of routeMatches) {
    if (!routePath.startsWith("/") || routePath.includes("?") || routePath.includes("#")) continue;

    const normalizedRoute = routePath.replace(/\/$/, "") || "/";
    const pagePath = normalizedRoute === "/"
        ? path.join(appDir, "page.tsx")
        : path.join(appDir, ...normalizedRoute.slice(1).split("/"), "page.tsx");

    validatedCount += 1;

    if (!existsSync(pagePath)) {
        missingPages.push({
            routeName,
            routePath,
            expectedPage: path.relative(projectRoot, pagePath),
        });
    }
}

const navigationRouteMatches = [...navigationSource.matchAll(/\bnavItem\("([^"]+)"/g)];
const unknownNavigationRoutes = [];
const navigationPolicyMismatches = [];
const validatedNavigationKeys = new Set();
const routePolicyMatches = [...policiesObjectSource.matchAll(/^\s*([a-zA-Z0-9_]+):\s*"([^"]+)"/gm)];
const routePoliciesByKey = new Map(routePolicyMatches.map(([, routeName, routePolicy]) => [routeName, routePolicy]));
const missingRoutePolicies = [];
const unknownRoutePolicies = [];
const requiredDynamicPolicyPrefixes = [
    "/marketplace/",
    "/providers/",
    "/governance/",
    "/explorer/nodes/",
    "/explorer/contracts/",
    "/explorer/wallets/",
    "/explorer/blocks/",
    "/explorer/transactions/",
    "/community/forum/category/",
    "/community/forum/thread/",
    "/dashboard/wallet/callback",
];

for (const routeName of routesByKey.keys()) {
    if (!routePoliciesByKey.has(routeName)) {
        missingRoutePolicies.push(routeName);
    }
}

for (const routeName of routePoliciesByKey.keys()) {
    if (!routesByKey.has(routeName)) {
        unknownRoutePolicies.push(routeName);
    }
}

for (const [, routeKey] of navigationRouteMatches) {
    validatedNavigationKeys.add(routeKey);

    if (!routesByKey.has(routeKey)) {
        unknownNavigationRoutes.push(routeKey);
    }
}

const navigationItemMatches = [...navigationSource.matchAll(/navItem\(\s*"([^"]+)"([\s\S]*?)\)/g)];
for (const [, routeKey, navItemBody] of navigationItemMatches) {
    if (!routesByKey.has(routeKey)) continue;

    const explicitNavigationPolicy = navItemBody.match(/policy:\s*"([^"]+)"/)?.[1];
    if (!explicitNavigationPolicy) continue;
    const routePolicy = routePoliciesByKey.get(routeKey);

    if (routePolicy && explicitNavigationPolicy !== routePolicy) {
        navigationPolicyMismatches.push({
            routeKey,
            navigationPolicy: explicitNavigationPolicy,
            routePolicy,
        });
    }
}

const missingDynamicPolicyPrefixes = requiredDynamicPolicyPrefixes.filter(prefix => !policiesSource.includes(`prefix: "${prefix}"`));

const middlewarePolicyChecks = [
    ["getRoutePolicyForPathname", "middleware must resolve policy by pathname"],
    ["isRoleAllowedForPolicy", "middleware must enforce role permissions"],
    ["routePolicy === 'public'", "middleware must allow public routes before auth"],
    ["/((?!api|_next/static|_next/image|favicon.ico|.*\\\\..*).*)", "middleware matcher must cover page routes"],
];

const missingMiddlewareChecks = middlewarePolicyChecks
    .filter(([needle]) => !middlewareSource.includes(needle))
    .map(([, message]) => message);

if (missingPages.length > 0) {
    console.error("Route registry validation failed. These ROUTES entries do not have matching app pages:");
    for (const missing of missingPages) {
        console.error(`- ${missing.routeName}: ${missing.routePath} -> ${missing.expectedPage}`);
    }
    process.exit(1);
}

if (unknownNavigationRoutes.length > 0) {
    console.error("Navigation registry validation failed. These navItem route keys are not defined in ROUTES:");
    for (const routeKey of unknownNavigationRoutes) {
        console.error(`- ${routeKey}`);
    }
    process.exit(1);
}

if (missingRoutePolicies.length > 0) {
    console.error("Route policy validation failed. These ROUTES entries do not have a ROUTE_POLICIES entry:");
    for (const routeKey of missingRoutePolicies) {
        console.error(`- ${routeKey}`);
    }
    process.exit(1);
}

if (unknownRoutePolicies.length > 0) {
    console.error("Route policy validation failed. These ROUTE_POLICIES entries are not defined in ROUTES:");
    for (const routeKey of unknownRoutePolicies) {
        console.error(`- ${routeKey}`);
    }
    process.exit(1);
}

if (navigationPolicyMismatches.length > 0) {
    console.error("Navigation policy validation failed. These navItem policies do not match ROUTE_POLICIES:");
    for (const mismatch of navigationPolicyMismatches) {
        console.error(`- ${mismatch.routeKey}: nav=${mismatch.navigationPolicy}, route=${mismatch.routePolicy}`);
    }
    process.exit(1);
}

if (missingMiddlewareChecks.length > 0) {
    console.error("Middleware policy validation failed:");
    for (const check of missingMiddlewareChecks) {
        console.error(`- ${check}`);
    }
    process.exit(1);
}

if (missingDynamicPolicyPrefixes.length > 0) {
    console.error("Dynamic route policy validation failed. Missing explicit prefixes:");
    for (const prefix of missingDynamicPolicyPrefixes) {
        console.error(`- ${prefix}`);
    }
    process.exit(1);
}

console.log(`Validated ${validatedCount} static route registry entries.`);
console.log(`Validated ${validatedNavigationKeys.size} navigation route keys.`);
console.log(`Validated ${routePoliciesByKey.size} route policy entries.`);
console.log(`Validated ${requiredDynamicPolicyPrefixes.length} dynamic route policy prefixes.`);
console.log("Validated middleware route policy guard coverage.");

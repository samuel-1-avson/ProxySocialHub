import { test, expect } from "@playwright/test";
import { seedSignedAuth } from "./fixtures/signed-auth";

test("privacy defaults, disclosure acknowledgment, and saved audience previews", async ({page})=>{
 test.setTimeout(120000);
 const base=process.env.TEST_BASE_URL||"http://localhost:4011";
 await page.route("**/v1/**",route=>route.fulfill({status:503,json:{error:"Fixture source unavailable"}}));
 await seedSignedAuth(page,base,"buyer");
 let privacy={profile_public:false,discoverable:false,map_visible:false,map_precision:"country",presence_visible:false,activity_public:false,contact_mode:"contacts",analytics_opt_in:false,allow_direct_connections:false,public_chain_consent:false};
 let saved:Record<string,unknown>|undefined;
 await page.route("**/v1/profile/privacy",async route=>{
  if(route.request().method()==="PUT") {saved=route.request().postDataJSON();privacy={...privacy,...saved};}
  return route.fulfill({json:privacy});
 });
 await page.route("**/v1/profile/privacy/preview",route=>route.fulfill({json:{guest_profile:{username:"random_alias"},profile_page_visible:privacy.profile_public,map_visible:privacy.map_visible,precision:privacy.map_precision,audiences:{guest:{note:"Public alias only."},contact:{note:"Approved contacts may message."},buyer:{note:"Purchased sessions disclose the provider endpoint."}}}}));
 await page.route("**/v1/listings/my",route=>route.fulfill({json:{listings:[]}}));
 await page.route("**/v1/gdpr/deletion",route=>route.fulfill({json:{scheduled_deletion_at:null}}));
 await page.goto(base+"/app/settings?tab=privacy",{waitUntil:"domcontentloaded"});
 await expect(page.getByRole("heading",{name:"Privacy & visibility"})).toBeVisible();
 await expect(page.getByRole("checkbox",{name:/Show my public profile/})).not.toBeChecked();
 await expect(page.getByRole("checkbox",{name:/Allow optional marketplace analytics/})).not.toBeChecked();
 await expect(page.getByRole("combobox",{name:"Who may start a conversation?"})).toHaveValue("contacts");
 await page.getByRole("checkbox",{name:/Allow direct peer connections/}).check();
 await expect(page.getByRole("button",{name:"Save privacy settings"})).toBeDisabled();
 await page.getByRole("checkbox",{name:"I understand that direct peers can learn my network address."}).check();
 await page.getByRole("button",{name:"Save privacy settings"}).click();
 await expect(page.getByRole("status").filter({hasText:"Privacy settings saved."})).toBeVisible();
 expect(saved?.acknowledge_ip_disclosure).toBe(true);expect(saved?.analytics_opt_in).toBe(false);
 await page.getByRole("combobox",{name:"View as"}).selectOption("buyer");
 await expect(page.getByText("Purchased sessions disclose the provider endpoint.")).toBeVisible();
 await expect(page.getByRole("button",{name:"Download my data"})).toBeVisible();
});

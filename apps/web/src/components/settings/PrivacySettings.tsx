"use client";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { apiGet, apiPut, apiPatch } from "@/lib/api/client";
import { DataError, Loading } from "@/components/workspace/Patterns";

type Privacy = {
  profile_public: boolean; discoverable: boolean; map_visible: boolean; map_precision: "country" | "city";
  presence_visible: boolean; activity_public: boolean; contact_mode: "nobody" | "contacts" | "inquiries" | "everyone";
  analytics_opt_in: boolean; allow_direct_connections: boolean; public_chain_consent: boolean;
};
const options = [
  ["profile_public", "Show my public profile", "Publish the personal profile fields you fill in. Public contributions can still show your alias when this is off."],
  ["discoverable", "Include me in people discovery", "Requires a public profile. This is separate from publishing a proxy offer."],
  ["map_visible", "Show my provider nodes on the public map", "Publish approximate location and node health. Buyers can observe the egress IP when they use your proxy, even when map visibility is off."],
  ["presence_visible", "Share online status and approximate last seen", "Off hides presence from public profiles and the presence API."],
  ["activity_public", "Publish my social activity", "Share selected public announcements and achievements. Private inquiries are excluded."],
  ["analytics_opt_in", "Allow optional marketplace analytics", "Billing and security records are still needed to operate your account."],
  ["allow_direct_connections", "Allow direct peer connections", "Both participants must consent. Direct connections can reveal network addresses to the counterparty."],
  ["public_chain_consent", "Allow public KYC attestations", "KYC status and its wallet link may be written to Solana. Existing chain records cannot be hidden or erased by changing these settings."],
] as const;

export function PrivacySettings() {
  const { user } = useAuth(); const client = useQueryClient();
  const [draft, setDraft] = useState<Privacy | null>(null); const [ackIP, setAckIP] = useState(false); const [ackChain, setAckChain] = useState(false); const [saved, setSaved] = useState(false);
  const [audience,setAudience]=useState("guest");
  const listings=useQuery({queryKey:["privacy-listings",user?.id],queryFn:()=>apiGet<{listings:{id:string;title:string;allow_direct_message:boolean}[]}>("/v1/listings/my"),enabled:!!user});
  const contact=useMutation({mutationFn:({id,allow}:{id:string;allow:boolean})=>apiPatch(`/v1/listings/${id}/contact`,{allow_direct_message:allow}),onSuccess:()=>{void client.invalidateQueries({queryKey:["privacy-listings",user?.id]});}});
  const query = useQuery({ queryKey: ["privacy", user?.id], queryFn: () => apiGet<Privacy>("/v1/profile/privacy"), enabled: !!user });
  useEffect(() => { if (query.data) setDraft(query.data); }, [query.data]);
  const save = useMutation({ mutationFn: () => apiPut<Privacy>("/v1/profile/privacy", { ...Object.fromEntries(options.map(([key]) => [key, draft?.[key]])), map_precision: draft?.map_precision, contact_mode: draft?.contact_mode, acknowledge_ip_disclosure: ackIP, acknowledge_chain_disclosure: ackChain }), onSuccess: (data) => { client.setQueryData(["privacy", user?.id], data); setSaved(true); setAckIP(false); setAckChain(false); void client.invalidateQueries({ queryKey: ["privacy-preview", user?.id] }); } });
  const preview = useQuery({ queryKey: ["privacy-preview", user?.id], queryFn: () => apiGet<{ profile_page_visible: boolean; guest_profile: { username?: string }; audiences: Record<string,{note:string}>; map_visible: boolean; precision: string }>("/v1/profile/privacy/preview"), enabled: !!user });
  if (query.isLoading) return <Loading label="Loading privacy settings…" />;
  if (query.isError) return <DataError error={query.error} retry={() => void query.refetch()} />;
  if (!draft) return null;
  const needsIP = draft.allow_direct_connections && !query.data?.allow_direct_connections; const needsChain = draft.public_chain_consent && !query.data?.public_chain_consent;
  return <form className="ui-page" onSubmit={(e) => { e.preventDefault(); setSaved(false); save.mutate(); }}>
    <div><h2>Privacy & visibility</h2><p className="ui-note">These choices control marketplace disclosure. ProxyHubb operators handle account and network metadata; public settlement wallets remain linkable. These settings do not provide absolute anonymity.</p></div>
    {options.map(([key, label, description]) => <label className="ui-row" key={key}><span><strong>{label}</strong><span className="ui-note block">{description}</span></span><input type="checkbox" checked={draft[key]} onChange={(e) => { setSaved(false); setDraft({ ...draft, [key]: e.target.checked }); }} /></label>)}
    <label className="ui-field">Maximum map precision<select className="ui-input" value={draft.map_precision} onChange={(e) => setDraft({ ...draft, map_precision: e.target.value as Privacy["map_precision"] })}><option value="country">Country area</option><option value="city">City area (approximate)</option></select></label>
    <label className="ui-field">Who may start a conversation?<select className="ui-input" value={draft.contact_mode} onChange={(e) => setDraft({ ...draft, contact_mode: e.target.value as Privacy["contact_mode"] })}><option value="contacts">Approved contacts</option><option value="inquiries">Approved contacts & listing inquiries</option><option value="everyone">Everyone</option><option value="nobody">Nobody</option></select></label>
    <p className="ui-note">An existing conversation you have replied to remains open. Choose Nobody or block the account to stop further messages. Listing inquiries also require that listing's message preference.</p>
    {needsIP && <label className="ui-row"><span>I understand that direct peers can learn my network address.</span><input type="checkbox" checked={ackIP} onChange={(e) => setAckIP(e.target.checked)} /></label>}
    {needsChain && <label className="ui-row"><span>I understand that public KYC and wallet records cannot be withdrawn.</span><input type="checkbox" checked={ackChain} onChange={(e) => setAckChain(e.target.checked)} /></label>}
    {save.isError && <DataError error={save.error} />}{saved && <p role="status">Privacy settings saved.</p>}
    <button className="ui-button" disabled={save.isPending || (needsIP && !ackIP) || (needsChain && !ackChain)}>{save.isPending ? "Saving…" : "Save privacy settings"}</button>
    {preview.data && <aside className="ui-note" aria-label="Saved guest preview"><h3>Saved audience preview</h3><label>View as<select className="ui-input" value={audience} onChange={(e)=>setAudience(e.target.value)}><option value="guest">Guest</option><option value="contact">Approved contact</option><option value="buyer">Buyer</option></select></label><p>{preview.data.audiences?.[audience]?.note}</p><p>Alias: {preview.data.guest_profile.username || "Account alias"}. Profile page: {preview.data.profile_page_visible ? "Public" : "Private"}. Map: {preview.data.map_visible ? "Visible at " + preview.data.precision + " precision or less" : "Hidden"}.</p></aside>}
    {!!listings.data?.listings?.length && <aside><h3>Listing inquiries</h3><p className="ui-note">Also choose a conversation mode that allows listing inquiries.</p>{listings.data.listings.map((listing)=><label className="ui-row" key={listing.id}><span>{listing.title}</span><input type="checkbox" checked={listing.allow_direct_message} disabled={contact.isPending} onChange={(e)=>contact.mutate({id:listing.id,allow:e.target.checked})}/></label>)}{contact.isError&&<DataError error={contact.error}/>}</aside>}
  </form>;
}

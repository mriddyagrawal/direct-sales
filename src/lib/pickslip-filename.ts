// The filename for a shared/downloaded pick-slip PDF: "<ref> - <retailer>.pdf".
// The unique order ref leads (so two orders for the same shop never collide and
// they sort by order number), then the retailer name for readability — so the
// shop is identifiable in WhatsApp/Files even when the share caption is lost:
// Android's Web-Share drops the `text`/`title` when a file is attached, so the
// *filename* is the only field that reliably surfaces on both platforms. Strips
// only filesystem-reserved characters and keeps the name short. Falls back to
// just the ref if the retailer name is empty.
export function pickSlipFileName(retailerName: string, orderRef: string): string {
  const safe = retailerName
    .replace(/[/\\:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 50);
  return safe ? `${orderRef} - ${safe}.pdf` : `${orderRef}.pdf`;
}

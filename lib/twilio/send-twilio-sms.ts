export async function sendTwilioSms({
  to,
  body,
}: {
  to: string
  body: string
}) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID

  if (!accountSid || !authToken || !messagingServiceSid) {
    throw new Error("Twilio environment variables are missing.")
  }

  const cleanTo = String(to || "").trim()
  const cleanBody = String(body || "").trim()

  if (!cleanTo) throw new Error("Missing SMS recipient phone number.")
  if (!cleanBody) throw new Error("Missing SMS message body.")

  const params = new URLSearchParams()
  params.append("To", cleanTo)
  params.append("MessagingServiceSid", messagingServiceSid)
  params.append("Body", cleanBody)

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization:
          "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    },
  )

  const result = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(result.message || "Twilio send failed.")
  }

  return result
}

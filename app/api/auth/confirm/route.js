import { NextResponse } from 'next/server'

export async function GET(req) {
  const { searchParams } = new URL(req.url)
  const token = searchParams.get('token')
  const type = searchParams.get('type') || 'magiclink'

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://reports.vitas.co.il'

  if (!token) {
    return NextResponse.redirect(`${siteUrl}/client?error=missing_token`)
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const verifyUrl =
    `${supabaseUrl}/auth/v1/verify` +
    `?token=${encodeURIComponent(token)}` +
    `&type=${encodeURIComponent(type)}` +
    `&redirect_to=${encodeURIComponent(`${siteUrl}/client`)}`

  return NextResponse.redirect(verifyUrl)
}

import { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory } from '@google/generative-ai'
import { defineAction } from 'astro:actions'
import { z } from 'astro:schema'
import { getAuthPB, getPublicPB } from '../lib/server/pb'
import { Collections } from '../types/pocketbase-types'

const genAI = new GoogleGenerativeAI(import.meta.env.GEMINI_API_KEY)

const cosineSimilarity = (vecA: number[], vecB: number[]) => {
  const dotProduct = vecA.reduce((acc, val, idx) => acc + val * vecB[idx], 0)
  const magA = Math.sqrt(vecA.reduce((acc, val) => acc + val * val, 0))
  const magB = Math.sqrt(vecB.reduce((acc, val) => acc + val * val, 0))
  return dotProduct / (magA * magB)
}

export const server = {
  logout: defineAction({
    accept: 'form',
    handler: async (_, context) => {
      const pb = getAuthPB(context.request)
      pb.authStore.clear()
      context.cookies.delete('pb_auth', { path: '/', secure: true, httpOnly: true })
      return { success: true }
    },
  }),

  chatWithAI: defineAction({
    accept: 'json',
    input: z.object({
      message: z.string(),
      history: z.array(z.any()).optional(),
      sessionId: z.string(),
    }),
    handler: async ({ message, history, sessionId }) => {
      const pb = getPublicPB()
      const cleanMsg = message.trim().toLowerCase()
      const exactMatch = await pb
        .collection(Collections.ChatCache)
        .getFirstListItem(`question = "${cleanMsg}"`)
        .catch(() => null)
      if (exactMatch) {
        return {
          text: exactMatch.answer,
          cacheId: exactMatch.id,
          isSemantic: false,
        }
      }
      const embedVecModel = genAI.getGenerativeModel({
        model: 'text-embedding-004',
      })
      const embedVecUser = await embedVecModel.embedContent(cleanMsg)
      const currentVector = embedVecUser.embedding.values

      let validHistory = history || []
      if (validHistory.length > 0 && validHistory[0].role === 'model') {
        validHistory = validHistory.slice(1)
      }

      const cachedEntries = await pb.collection(Collections.ChatCache).getFullList({
        // filter: `sessionId = "${sessionId}"`,
        // sort: "-created",
        // query: { sessionId: sessionId }, // For API Rules
      })
      let bestMatch = null
      let highestScore = 0
      for (const entry of cachedEntries) {
        if (!entry.embedding) continue
        const score = cosineSimilarity(currentVector, entry.embedding as number[])
        if (score > highestScore) {
          highestScore = score
          bestMatch = entry
        }
      }

      // Threshold: 0.85 to 0.90 is usually a "safe" semantic match
      if (highestScore > 0.9) {
        return {
          text: bestMatch?.answer,
          cacheId: bestMatch?.id,
          isSemantic: true,
        }
      }

      // 1. Fetch live data from PocketBase to feed the AI context
      const projects = await pb.collection(Collections.Projects).getFullList({
        fields: 'title,category,status,addressLine1,city,district,state,pincode,description',
      })

      // 2. Format project data into a readable string for the AI
      const projectContext = projects
        .map(
          (p) =>
            `- ${p.title}: A ${p.category} project located at ${
              p.addressLine1
            }, ${p.city} ${p.district} ${p.state} ${p.pincode ?? ''}.${p.description}`
        )
        .join('\n')

      // 3. Initialize Gemini 2.0 Flash
      const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash-lite', // Using the latest Flash model
        safetySettings: [
          {
            category: HarmCategory.HARM_CATEGORY_HARASSMENT,
            threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE,
          },
          {
            category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
            threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE,
          },
        ],
        systemInstruction: `
          You are the Aspada Assistant. You represent Aspada Developers in Shivamogga.
          Use the following live project data to answer user queries:
          ${projectContext}

          Guidelines:
          - If a user asks about a project not listed above, say we are constantly expanding and ask for their contact info.
          - Be concise, professional, and luxury-oriented.
          - Always mention that site visits are available upon request.
        `,
      })

      const chat = model.startChat({ history: validHistory || [] })
      const result = await chat.sendMessage(message)
      const aiResponse = result.response.text()
      // 5. ASYNC BACKGROUND TASKS (Don't 'await' these to keep chat fast)

      // Save to Server Cache
      const newCache = await pb.collection(Collections.ChatCache).create({
        question: cleanMsg,
        answer: aiResponse,
        embedding: embedVecUser.embedding.values,
        isSemantic: false,
      })

      // Save to Conversation Logs (Realtime trigger)
      pb.collection(Collections.ChatLogs)
        .create({
          session_id: sessionId,
          role: 'user',
          content: message,
        })
        .then(() => {
          pb.collection('chat_logs').create({
            session_id: sessionId,
            role: 'model',
            content: aiResponse,
          })
        })

      // LEAD EXTRACTION: Check if user shared a 10-digit Indian phone number
      const phoneMatch = message.match(/[6-9]\d{9}/)
      if (phoneMatch) {
        pb.collection('leads')
          .create({
            contactNo: phoneMatch[0],
            status: 'New',
            interest: `Inquiry during session ${sessionId}`,
          })
          .catch(() => null)
      }

      return { text: aiResponse, cacheId: newCache.id, isSemantic: false }
    },
  }),

  submitFeedback: defineAction({
    input: z.object({
      cacheId: z.string(),
      isHelpful: z.boolean(),
    }),
    handler: async ({ cacheId, isHelpful }) => {
      const pb = getPublicPB()
      const checkIsHelpful = isHelpful ? 'helpful_count+' : 'unhelpful_count+'
      // Atomic increment in PocketBase
      return await pb.collection(Collections.ChatCache).update(cacheId, {
        [checkIsHelpful]: 1,
      })
    },
  }),

  submitContact: defineAction({
    input: z.object({
      fullName: z.string(),
      contactEmail: z.string().email(),
      contactNo: z
        .string()
        .min(10)
        .max(10)
        .regex(/^[6-9]\d{9}$/, 'Invalid Indian phone number'),
      interest: z.string().max(512),
    }),
    handler: async ({ fullName, contactEmail, contactNo, interest }, context) => {
      const pb = getAuthPB(context.request)
      return await pb.collection(Collections.Leads).create({
        fullName,
        contactEmail,
        contactNo,
        interest,
        source: 'aspadaForms',
        status: 'New',
      })
    },
  }),
}

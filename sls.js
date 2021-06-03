const Koa = require('koa')
const KoaRouter = require('koa-router')
const fetch = require('node-fetch')
const xml2js = require('xml2js')
const xmlParser = new xml2js.Parser({ tagNameProcessors: [xml2js.processors.firstCharLowerCase], explicitArray: false })
const koaXmlBody = require('koa-xml-body')

const cp = require('child_process')
const exiftoolBin = require('exiftool-vendored.pl')

const MAGIC_VARIABLE_RE = /\$\(([^)]+)\)/

function getEndpoint ({ name, region, key }) {
  return `https://${name}.cos.${region}.myqcloud.com${key ? '/' + key : ''}`
}

class MagicVariableProcessor {
  async mimeType ({ url }) {
    const response = await fetch(url, { method: 'HEAD' })
    return response.headers.get('content-type')
  }
  
  async imageInfo ({ url }) {
    const response = await fetch(url + '?imageInfo')
    return await response.json()
  }
  
  async 'imageInfo.width' (context) {
    return (await this.process(context, 'imageInfo')).width
  }
  
  async 'imageInfo.height' (context) {
    return (await this.process(context, 'imageInfo')).height
  }
  
  async 'avinfo.video.tags.rotate' ({ url }) {
    let result = 0
    
    try {
      const response = await fetch(url)
      
      if (!response.ok) {
        throw new Error(`unexpected response ${response.statusText}`)
      }
      
      const data = await new Promise(async (resolve, reject) => {
        const exif = cp.spawn('perl', [exiftoolBin, '-Rotation', '-'], {
          stdio: "pipe",
          detached: false
        })
        
        exif.on('error', (err) => {
          reject('Unable to load exif tool. ' + err)
        })
        
        let ret = ''
        let errorMessage = ''
        exif.stdout.on('data', function (data) {
          ret += data
        })
        
        // Read an error response back and deal with it.
        exif.stderr.on('data', function (data) {
          errorMessage += data.toString()
        })
        
        exif.on('close', function () {
          if (errorMessage) {
            reject(errorMessage)
          } else {
            // Split the response into lines.
            ret = ret.split('\n')
            
            //For each line of the response extract the meta data into a nice associative array
            const metaData = {}
            ret.forEach(function (responseLine) {
              const pieces = responseLine.split(': ')
              //Is this a line with a meta data pair on it?
              if (pieces.length === 2) {
                //Turn the plain text data key into a camel case key.
                const key = pieces[0].trim()
                //Trim the value associated with the key to make it nice.
                var value = pieces[1].trim()
                if (!isNaN(value)) {
                  value = parseFloat(value, 10)
                }
                metaData[key] = value
              }
            })
            resolve(metaData)
          }
        })
        
        response.body.pipe(exif.stdin)
      })
      
      result = data.Rotation || 0
    } catch (err) {
      console.error('fetching rotation error', err)
    }
    
    return result.toString()
  }
  
  async avinfo ({ url }) {
    const response = await fetch(url + '?ci-process=videoinfo')
    const result = {}
    
    const xml = await xmlParser.parseStringPromise(await response.text())
    const stream = xml.response.mediaInfo.stream
    
    const xmlAudio = stream.audio
    if (xmlAudio) {
      result.audio = {
        duration: parseFloat(xmlAudio.duration)
      }
    }
    
    const xmlVideo = stream.video
    if (xmlVideo) {
      result.video = {
        duration: parseFloat(xmlVideo.duration),
        width: parseInt(xmlVideo.width),
        height: parseInt(xmlVideo.height)
      }
    }
    return result
  }
  
  async 'avinfo.video.width' (context) {
    return (await this.process(context, 'avinfo')).video.width
  }
  
  async 'avinfo.video.height' (context) {
    return (await this.process(context, 'avinfo')).video.height
  }
  
  async 'avinfo.video.duration' (context) {
    return (await this.process(context, 'avinfo')).video.duration
  }
  
  async 'avinfo.audio.duration' (context) {
    return (await this.process(context, 'avinfo')).audio.duration
  }
  
  async process (context, name) {
    if (!context[name]) {
      context[name] = await this[name](context)
    }
    
    return context[name]
  }
}

const magicVariableProcessor = new MagicVariableProcessor()

const app = new Koa()
app.use(koaXmlBody({ explicitArray: false }))
const router = new KoaRouter()

router.get('/callback', async function (ctx) {
  const { key, bucket, region, etag, ...query } = ctx.query
  const params = {}
  
  const context = { url: getEndpoint({ name: bucket, region, key }), key, type: query.type }
  
  for (const key of Object.keys(query)) {
    let value = ctx.query[key]
    const m = MAGIC_VARIABLE_RE.exec(value)
    
    if (m) {
      const varname = m[1]
      value = await magicVariableProcessor.process(context, varname)
    }
    
    params[key] = value
  }
  
  ctx.body = params
})

router.post('/callback/workflow', async function (ctx) {
  console.log(JSON.stringify({body: ctx.request.body, query: ctx.query}, null, 2 ))
  ctx.body = ''
})
app.use(router.allowedMethods()).use(router.routes())

// don't forget to export!
module.exports = app

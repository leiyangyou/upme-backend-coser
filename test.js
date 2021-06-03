const cp = require('child_process')
const fetch = require('node-fetch')
const exiftoolBin = require('exiftool-vendored.pl')
const { pipeline } = require('stream')
const { promisify } = require('util')
const streamPipeline = promisify(pipeline)


 async function rotate ({ url }) {
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
            console.log('ret', ret)
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
        console.log(exiftoolBin)
        
        try {
          await streamPipeline(response.body, exif.stdin)
        } catch (err) {
          reject(err)
        }
      })
      
      console.log('data', data)
    } catch (err) {
      console.error(err)
    }
    
    return result
}
  
rotate({url: "https://upme-video-x-1252331805.cos.ap-shanghai.myqcloud.com/SelfIntroduction.mp4"})
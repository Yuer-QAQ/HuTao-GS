import Server from '@/server'
import getTTY, { ansiToHTML, TTY } from '../tty'
import Logger from '@/logger'
import commands, { ArgumentDefinition, CmdInfo, CommandDefinition, helpFormatCommand } from './commands'
import { Announcement } from '@/types/announcement'
import { escapeHtml } from '@/utils/escape'

const commandsAnnouncement: Announcement = {
  type: 2, // Game
  subtitle: 'Commands',
  title: 'Command list',
  banner: 'https://webstatic-sea.mihoyo.com/hk4e/announcement/img/banner/command.png',
  content: '<p style="white-space: pre-wrap;">〓Commands〓</p>',
  start: Date.now() + (365 * 24 * 60 * 60e3),
  end: Date.now(),
  tag: 3,
  loginAlert: false
}

const errLogger = new Logger('CLIERR', 0xff8080)
const logger = new Logger('CLIOUT', 0xffffff)

function parseArg(arg: string, def: ArgumentDefinition): any {
  // optional argument check
  if (def.optional && arg == null) return

  // argument type check
  const type = def.type || 'str'
  switch (type) {
    case 'str': {
      if (typeof arg !== 'string') return { error: `Type error: (${def.name}) must be a ${type}.` }
      return arg
    }
    case 'flt': {
      const float = parseFloat(arg)
      if (isNaN(float)) return { error: `Type error: (${def.name}) must be a ${type}.` }
      return float
    }
    case 'int': {
      const int = parseInt(arg)
      if (isNaN(int)) return { error: `Type error: (${def.name}) must be a ${type}.` }
      return int
    }
    case 'num': {
      const num = Number(arg)
      if (isNaN(num)) return { error: `Type error: (${def.name}) must be a ${type}.` }
      return num
    }
    case 'b64':
    case 'hex': {
      try {
        return Buffer.from(arg, type.split('-')[0] as BufferEncoding)
      } catch (err) {
        return { error: `Type error: (${def.name}) must be a ${type}.` }
      }
    }
    default:
      return { error: `Definition error: Unknown argument type (${type}).` }
  }
}

function parseArgs(args: string[], cmdDef: CommandDefinition): any {
  const { args: argDef } = cmdDef
  const parsedArgs = []

  if (argDef == null) return []

  let parsingDynamic = false
  let result: any

  for (let i = 0; i < argDef.length; i++) {
    const def = argDef[i]
    const nextDef = argDef[i + 1]
    let arg = args[i]

    // definition error check
    if (nextDef && def.optional && !nextDef.optional) {
      return { error: 'Definition error: Cannot have required argument after optional argument.' }
    }
    if (parsingDynamic) {
      return { error: 'Definition error: Cannot have any argument after dynamic argument.' }
    }

    if (def.dynamic) {
      parsingDynamic = true
      arg = args.slice(i).join(' ')
    }

    result = parseArg(arg, def)

    if (result == null) continue
    if (result.error) return { error: result.error }

    parsedArgs.push(result)
  }

  return { args: parsedArgs }
}

export default class CLI {
  static prefix: string = '/'

  tty: TTY
  server: Server

  constructor(server: Server) {
    this.tty = getTTY()
    this.server = server

    this.handleLine = this.handleLine.bind(this)

    this.tty.on('exit', async () => {
      this.stop()
      this.server.stop()
    })

    for (let command of commands) {
      if (!command.allowPlayer) continue
      commandsAnnouncement.content += `<p style="white-space: pre-wrap;background: black;color: white;">◇ ${ansiToHTML(escapeHtml(helpFormatCommand(command, CLI.prefix)))}</p>`
    }

    server.webServer.announcements.push(commandsAnnouncement)
  }

  static execCommand(input: string, cmdInfo: CmdInfo): false | any[] {
    const cmdName = input.split(' ')[0]
    const args = input.split(' ').slice(1)

    const cmdDef = commands.find(cmd => cmd.name === cmdName)
    if (!cmdDef) return [`Unknown command: ${cmdName}`]

    if (!cmdDef.allowPlayer && cmdInfo.sender != null) return ['This command can only be used in console.']
    if (cmdDef.onlyAllowPlayer && cmdInfo.sender == null) return ['This command can only be used in game.']

    const parsed = parseArgs(args, cmdDef)
    if (parsed.error) return [parsed.error]

    cmdInfo.args = parsed.args

    try {
      cmdDef.exec(cmdInfo)
      return false
    } catch (err) {
      return ['Failed to execute command:', err]
    }
  }

  start() {
    this.tty.on('line', this.handleLine)
  }

  stop() {
    this.tty.on('line', this.handleLine)
  }

  print(...args: any[]) {
    logger.info(...args)
  }

  printError(...args: any[]) {
    errLogger.info(...args)
  }

  async handleLine(line: string): Promise<void> {
    const err = CLI.execCommand(line, {
      cli: this,
      server: this.server,
      kcpServer: this.server.kcpServer
    })
    if (err) this.printError(...err)
  }
}
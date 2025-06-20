const matchRepo = require('../outbound/MatchRepository');
const matchService = require('../../Application/Services/MatchService'); 

class MatchController {
    async getAll(req, reply)
    {
        const data = await matchService.getAll();
        return reply.send(data);
    }

    async getById(req, reply)
    {
        try {
            const data = await matchService.getById(req.params.id);
            return reply.send(data);
        } catch (error) {
            if (typeof error === 'number')
                return reply.code(error).send();

            return reply.code(400).send();
        }
    }

    async saveMatch(req, reply)
    {
        try {
            const body = req.body;
            await matchService.saveMatch(body);
        } catch (error) {
            if (typeof error === 'number')
                return reply.code(error).send();

            return reply.code(400).send();
        }
    }

    async savePlayers(req, reply)
    {
        try {
            const body = req.body;
            await matchService.savePlayers(body);
        } catch (error) {
            if (typeof error === 'number')
                return reply.code(error).send();

            return reply.code(400).send();
        }
    }
}

module.exports = new MatchController();
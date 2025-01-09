/*
 * Copyright (c) "Neo4j"
 * Neo4j Sweden AB [http://neo4j.com]
 *
 * This file is part of Neo4j.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as neo4j from "neo4j-driver";
import type { UniqueType } from "../../utils/graphql-types";
import { TestHelper } from "../../utils/tests-helper";

describe("issue/duplicate-connect", () => {
    const testHelper = new TestHelper();

    let Movie: UniqueType;
    let Actor: UniqueType;
    let Person: UniqueType;

    beforeEach(async () => {
        Movie = testHelper.createUniqueType("Movie");
        Actor = testHelper.createUniqueType("Actor");
        Person = testHelper.createUniqueType("Person");

        const typeDefs = /* GraphQL */ `
            type ${Movie} @node {
                title: String!
                runtime: Int
                actors: [${Actor}!]! @relationship(type: "ACTED_IN", direction: IN, properties: "ActedIn")
            }

            type ActedIn @relationshipProperties {
                screenTime: Int!
            }

            type ${Actor} @node {
                name: String!
                movies: [${Movie}!]! @relationship(type: "ACTED_IN", direction: OUT, properties: "ActedIn")
            }

            type ${Person} @node {
                name: String!
                friends: [${Person}!]! @relationship(type: "FRIEND_OF", direction: OUT)
            }
        `;

        await testHelper.initNeo4jGraphQL({
            typeDefs,
        });
    });

    afterEach(async () => {
        await testHelper.close();
    });

    test("update actors, updated nested movies to connect to another actor", async () => {
        const actorName = "actor1";
        const actorName2 = "actor2";
        const actorName3 = "another actor";

        const movieTitle = "movie1";
        const movieTitle2 = "movie2";
        const movieScreenTime = 94414;

        await testHelper.executeCypher(
            `
        
                CREATE (a:${Actor} { name: $actorName })
                CREATE (a2:${Actor} { name: $actorName2 })
                 CREATE (:${Actor} { name: $actorName3 })
               
                CREATE (m:${Movie} { title: $movieTitle })
                CREATE (m2:${Movie} { title: $movieTitle2 })
                CREATE (a)-[:ACTED_IN { screenTime: $movieScreenTime }]->(m)
                CREATE (a)-[:ACTED_IN { screenTime: $movieScreenTime }]->(m2)
                CREATE (a2)-[:ACTED_IN { screenTime: $movieScreenTime }]->(m2)
            `,
            {
                actorName,
                actorName2,
                actorName3,
                movieTitle,
                movieTitle2,
                movieScreenTime,
            }
        );
        // is this even a bug ? by the time another actor is reached is already connected to the movie therefore it connects to himself again
        const query = /* GraphQL */ `
            mutation {
                ${Actor.operations.update}(update: { 
                    movies: [{ 
                        where: { node: { title: { eq: "${movieTitle}" } } } 
                        update: { 
                            node: { 
                                actors: [{                          
                                    connect: {  
                                        where: { node: { name: { eq: "${actorName3}" } } }, 
                                        edge: { screenTime: 111 }, 
                                    } 
                                }] 
                            } 
                        } 
                    }] 
                }) {
                    ${Actor.plural} {
                        name
                        moviesConnection {
                            edges {
                                node {
                                    title
                                }
                                properties {
                                    screenTime
                                }
                            }
                        }
                    }
                }
            }
        `;

        const gqlResult = await testHelper.executeGraphQL(query);

        expect(gqlResult.errors).toBeFalsy();
        console.log(JSON.stringify(gqlResult, null, 2));
        expect(gqlResult.data).toEqual({
            [Actor.operations.update]: {
                [Actor.plural]: expect.toIncludeSameMembers([
                    {
                        name: actorName,
                        moviesConnection: {
                            edges: expect.toIncludeSameMembers([
                                {
                                    node: {
                                        title: movieTitle,
                                    },
                                    properties: {
                                        screenTime: movieScreenTime,
                                    },
                                },
                                {
                                    node: {
                                        title: movieTitle2,
                                    },
                                    properties: {
                                        screenTime: movieScreenTime,
                                    },
                                },
                            ]),
                        },
                    },
                    {
                        name: actorName2,
                        moviesConnection: {
                            edges: [
                                {
                                    node: {
                                        title: movieTitle2,
                                    },
                                    properties: {
                                        screenTime: movieScreenTime,
                                    },
                                },
                            ],
                        },
                    },
                    {
                        name: actorName3,
                        moviesConnection: {
                            edges: [
                                {
                                    node: {
                                        title: movieTitle,
                                    },
                                    properties: {
                                        screenTime: 111,
                                    },
                                },
                            ],
                        },
                    },
                ]),
            },
        });

        const rawResult = await testHelper.executeCypher(
            `
                MATCH (a:${Actor})-[r:ACTED_IN]->(m:${Movie})
                RETURN a.name as name, r.screenTime as screenTime, m.title as title
            `,
            {}
        );

        const result = rawResult.records.map((record) => record.toObject());
        console.log(JSON.stringify(result, null, 2));
        expect(result).toIncludeSameMembers([
            {
                name: actorName,
                screenTime: neo4j.int(movieScreenTime),
                title: movieTitle,
            },
            {
                name: actorName,
                screenTime: neo4j.int(movieScreenTime),
                title: movieTitle2,
            },
            {
                name: actorName2,
                screenTime: neo4j.int(movieScreenTime),
                title: movieTitle2,
            },
            {
                name: actorName3,
                screenTime: neo4j.int(movieScreenTime),
                title: movieTitle,
            },
        ]);
    });

    // an alternative case of the above test
    test("connect, connect", async () => {
        const keanu = "Keanu";
        const notKeanu = "Not-Keanu";

        const matrix = "The Matrix";
        const matrix2 = "The Matrix Reloaded";
        const matrix3 = "The Matrix Revolutions";
        const johnWick = "John Wick";
        const movieScreenTime = 120;

        await testHelper.executeCypher(
            `
                CREATE (a:${Actor} { name: $keanu })
                CREATE (a2:${Actor} { name: $notKeanu })
                CREATE (m:${Movie} { title: $matrix })
                CREATE (m2:${Movie} { title: $matrix2 })
                CREATE (m3:${Movie} { title: $matrix3 })
                CREATE (m4:${Movie} { title: $johnWick })
            `,
            {
                keanu,
                notKeanu,
                matrix,
                matrix2,
                matrix3,
                johnWick,
            }
        );

        const query = /* GraphQL */ `
            mutation {
                ${Movie.operations.update}(
                    update: { 
                        actors: [{ 
                            connect: { 
                                where: { node: { name: { eq: "${keanu}" } } }
                                edge: { screenTime: ${movieScreenTime} }
                                connect: {
                                    movies: {
                                        where: { node: { title: { eq: "${johnWick}" } } }, 
                                        edge: { screenTime: ${movieScreenTime} },
                                    }
                                     
                                }
                            } 
                        }] 
                    }
                ) {
                    ${Movie.plural} {
                        title
                        actorsConnection {
                            edges {
                                node {
                                    name
                                }
                                properties {
                                    screenTime
                                }
                            }
                        }
                    }
                }
            }
        `;

        const gqlResult = await testHelper.executeGraphQL(query);

        expect(gqlResult.errors).toBeFalsy();
        // TODO: write gql expectations

        const rawResult = await testHelper.executeCypher(
            `
                MATCH (a:${Actor})-[r:ACTED_IN]->(m:${Movie})
                RETURN a.name as name, r.screenTime as screenTime, m.title as title
            `,
            {}
        );

        const result = rawResult.records.map((record) => record.toObject());
        console.log(JSON.stringify(result, null, 2));

        expect(result).toIncludeSameMembers([
            {
                name: keanu,
                screenTime: neo4j.int(movieScreenTime),
                title: matrix,
            },
            {
                name: keanu,
                screenTime: neo4j.int(movieScreenTime),
                title: matrix2,
            },
            {
                name: keanu,
                screenTime: neo4j.int(movieScreenTime),
                title: matrix3,
            },
            {
                name: keanu,
                screenTime: neo4j.int(movieScreenTime),
                title: johnWick,
            }, // it returns 5 johnWick because it connects all the movie to John Wick even John Wick itself
        ]);
    });

    test.only("create with side effect", async () => {
        const keanu = "Keanu";
        const matrix = "The Matrix";
        const matrix2 = "The Matrix Reloaded";
        const movieScreenTime = 120;

        const query = /* GraphQL */ `
            mutation createWithSideEffects {
                ${Movie.operations.create}(
                    input: [
                        {
                            title: "${matrix}"
                            actors: { create: { edge: { screenTime: ${movieScreenTime} }, node: { name: "${keanu}" } } }
                        }
                        {
                            title: "${matrix2}"
                            actors: {
                                connect: { edge: { screenTime: ${movieScreenTime} }, where: { node: { name: { eq: "${keanu}" } } } }
                            }
                        }
                    ]
                ) {
                    ${Movie.plural} {
                        title
                    }
                }
            }
        `;
        // Does The Matrix 2 should be connected to Keanu  and the order of execution be respected?

        const gqlResult = await testHelper.executeGraphQL(query);

        expect(gqlResult.errors).toBeFalsy();
        // TODO: write gql expectations

        const rawResult = await testHelper.executeCypher(
            `
                MATCH (a:${Actor})-[r:ACTED_IN]->(m:${Movie})
                RETURN a.name as name, r.screenTime as screenTime, m.title as title
            `,
            {}
        );

        const result = rawResult.records.map((record) => record.toObject());
        console.log(JSON.stringify(result, null, 2));

        expect(result).toIncludeSameMembers([
            {
                name: keanu,
                screenTime: neo4j.int(movieScreenTime),
                title: matrix,
            },
            {
                name: keanu,
                screenTime: neo4j.int(movieScreenTime),
                title: matrix2,
            },
        ]);
    });
});
